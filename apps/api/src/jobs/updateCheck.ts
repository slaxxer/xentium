import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { prisma } from "../infrastructure/db.js";
import { redis, rkey } from "../infrastructure/redis.js";
import { bustSettingsCache } from "../shared/utils/settings.js";
import { logger } from "../infrastructure/logging/logger.js";
import {
  acceptRotatedToken, getAccountToken, protocolFetch,
} from "../core/license-engine/protocol-client.js";
import { getSiteDomain, getSiteId } from "../core/license-engine/site-identity.js";

/**
 * §16 daily update check-in: report the installed plugin inventory to the
 * marketplace and cache what came back (newer versions, critical flags,
 * published advisories). The ACP reads the cache — this is how customers see
 * advisories and critical updates BEFORE something stops working. The same call
 * feeds the marketplace's per-site inventory view.
 *
 * It is also where the account token ROTATES. Rotation rides the heartbeat
 * deliberately: it is the one recurring call, so there is no second path that
 * could hand out a credential nobody stores.
 *
 * Which is precisely why it must not run twice at once. It already can: the
 * worker fires one on boot AND the daily scheduler fires its missed run, in the
 * same millisecond. Two heartbeats mean two rotations, and the loser's token —
 * the one the marketplace minted last — is the one written, stranding the
 * other. Nothing breaks today only because rotation does not yet revoke the
 * token it replaces; that is an accident, not a design, and this is the same
 * race that silently signed people out of the portal.
 */
const UPDATES_SETTING = "marketplace.updates";

/** Comfortably longer than the call, far shorter than the daily cadence. */
const LOCK_TTL_SECONDS = 120;

/**
 * How a run ended, for the ACP's "Check now" (the scheduled callers ignore it):
 * `checked` wrote a fresh cache, `failed` kept the last one because the marketplace
 * did not answer, `busy` found another run holding the lock, `no-account` had no
 * connected account to check with.
 */
export type UpdateCheckOutcome = "checked" | "failed" | "busy" | "no-account";

export async function processUpdateCheck(): Promise<UpdateCheckOutcome> {
  if (!(await getAccountToken())) return "no-account"; // nothing to check against

  // Single-flight. NX+EX rather than a check-then-set: two racers must not both
  // see an unlocked key. A stale lock expires on its own, so a crashed run
  // costs one skipped heartbeat rather than a stuck one.
  const lock = rkey("marketplace", "heartbeat");
  const won = await redis.set(lock, String(Date.now()), "EX", LOCK_TTL_SECONDS, "NX");
  if (!won) {
    logger.debug("Marketplace heartbeat already running — skipping this trigger");
    return "busy";
  }

  try {
    return (await runUpdateCheck()) ? "checked" : "failed";
  } finally {
    await redis.del(lock).catch(() => {});
  }
}

const CHANGE_TYPES = new Set(["new", "improved", "fixed", "security", "breaking", "other"]);

/**
 * The marketplace's "what's new" for one update, kept to the shape the ACP renders:
 * per release, a list of typed changes. Remote text is stored as text (never HTML)
 * and bounded the way the marketplace bounds it (10 releases, 50 changes of 300
 * characters); an unknown type is shown as "other" rather than dropped.
 */
export function releaseNotes(raw: unknown): ReleaseNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleaseNote[] = [];
  for (const n of raw.slice(0, 10)) {
    if (!n || typeof n.version !== "string" || !Array.isArray(n.changes)) continue;
    const changes = (n.changes as unknown[])
      .filter((c): c is { type: unknown; text: string } =>
        !!c && typeof (c as { text?: unknown }).text === "string" && (c as { text: string }).text.trim() !== "")
      .slice(0, 50)
      .map((c) => ({
        type: typeof c.type === "string" && CHANGE_TYPES.has(c.type) ? c.type as ReleaseChangeType : "other" as const,
        text: c.text.trim().slice(0, 300),
      }));
    if (changes.length) {
      out.push({ version: n.version.slice(0, 40), changes, publishedAt: typeof n.publishedAt === "string" ? n.publishedAt : null });
    }
  }
  return out;
}

export type ReleaseChangeType = "new" | "improved" | "fixed" | "security" | "breaking" | "other";
export interface ReleaseNote {
  version: string;
  changes: { type: ReleaseChangeType; text: string }[];
  publishedAt: string | null;
}

/** The heartbeat itself. Only ever entered holding the lock above. False = no answer, cache kept. */
async function runUpdateCheck(): Promise<boolean> {
  // Keep both paid-id sets fresh. The plugin set drives the license-by-id enable
  // gate; the theme set only drives what the ACP offers and how a refused download
  // explains itself, but a stale one still shows an admin "Install" on something
  // they would then be charged for.
  const { marketplaceSource } = await import("../core/license-engine/marketplace-source.js");
  await marketplaceSource.refreshPaidPluginIds().catch(() => {});
  await marketplaceSource.refreshPaidThemeIds().catch(() => {});

  const plugins = await prisma.installedPlugin.findMany({
    select: { id: true, name: true, installedVersion: true },
  });

  interface CheckResponse {
    updates:    {
      id: string; latestVersion: string; critical?: boolean;
      /** "What's new" per release between installed and latest (marketplace ≥ 2026-10-19). */
      notes?: { version?: unknown; changes?: unknown; publishedAt?: unknown }[];
    }[];
    advisories: { id: string; target: string; affects: string; severity: string; fixedIn: string | null; summary?: string }[];
    token?:     string;
  }

  let body: CheckResponse;
  try {
    body = await protocolFetch<CheckResponse>({
      method: "POST",
      path:   "/updates/check",
      timeoutMs: 15_000,
      body: {
        siteId: await getSiteId(),
        domain: await getSiteDomain(),
        installed: plugins.map((p) => ({ id: p.id, kind: "plugin", version: p.installedVersion })),
      },
    });
  } catch (err) {
    logger.warn({ err }, "Marketplace update check failed — keeping last cache");
    return false;
  }

  // Store the replacement BEFORE anything else can fail: the marketplace has
  // already minted it, and the old one is only valid for a short overlap. A
  // write skipped because a later step threw is an install that locks itself
  // out on the next run.
  await acceptRotatedToken(body.token);

  // Enrich with what only this instance knows: the display name and the
  // version currently installed — the ACP renders "Forum 1.0.3 → 1.0.4".
  const byId = new Map(plugins.map((p) => [p.id, p]));
  // An advisory against something installed is a critical update, whatever the
  // release itself claims: the marketplace flags severity per advisory, and the
  // ACP's one "critical" bit is what actually reaches the admin.
  const advised = new Set(
    (body.advisories ?? [])
      .filter((a) => a.severity === "critical" || a.severity === "high")
      .map((a) => a.target),
  );
  const updates = (body.updates ?? []).map((u) => ({
    pluginId:         u.id,
    latestVersion:    u.latestVersion,
    critical:         u.critical === true || advised.has(u.id),
    name:             byId.get(u.id)?.name ?? u.id,
    installedVersion: byId.get(u.id)?.installedVersion ?? null,
    notes:            releaseNotes(u.notes),
  }));

  // Stable anchor for "when this exact set of pending updates first appeared".
  // The per-admin update dialog shows until the admin visits the Updates page
  // AFTER this instant; carrying it forward across unchanged re-checks (unlike
  // checkedAt, which moves every run) is what keeps an acknowledgement sticky.
  const setHash = updates.map((u) => `${u.pluginId}@${u.latestVersion ?? "?"}`).sort().join(",");
  const prevRaw = await prisma.setting.findUnique({ where: { key: UPDATES_SETTING } });
  let setSince = new Date().toISOString();
  try {
    const prevVal = prevRaw?.value;
    // The Json column holds a stringified payload (see the write below); tolerate
    // an already-parsed object too.
    const prev = (typeof prevVal === "string" ? JSON.parse(prevVal) : prevVal) as
      { updates?: { pluginId: string; latestVersion?: string }[]; setSince?: string } | null;
    const prevHash = (prev?.updates ?? []).map((u) => `${u.pluginId}@${u.latestVersion ?? "?"}`).sort().join(",");
    if (prev?.setSince && prevHash === setHash) setSince = prev.setSince; // unchanged set → keep the original anchor
  } catch { /* malformed prior cache → treat as a new set */ }

  // The advisories themselves, for the Updates page — until now they only flipped
  // `critical` above, so an admin was told to hurry without being told why, and an
  // advisory with no fix yet was not shown at all. The marketplace already sends
  // only those matching the installed version.
  const advisories = (body.advisories ?? [])
    .filter((a) => byId.has(a.target))
    .map((a) => ({
      id: a.id, pluginId: a.target, name: byId.get(a.target)?.name ?? a.target,
      severity: a.severity, affects: a.affects, fixedIn: a.fixedIn ?? null,
      summary: typeof a.summary === "string" ? a.summary.slice(0, 1000) : null,
    }));

  const value = JSON.stringify({ checkedAt: new Date().toISOString(), setSince, updates, advisories });
  await prisma.setting.upsert({
    where:  { key: UPDATES_SETTING },
    update: { value },
    create: { key: UPDATES_SETTING, value },
  });
  bustSettingsCache(UPDATES_SETTING);

  logger.info(
    { installed: plugins.length, updates: updates.length, advisories: (body.advisories ?? []).length },
    "Marketplace update check completed",
  );
  return true;
}

/**
 * The daily marketplace heartbeat — ONE scheduled job for both halves of the
 * conversation with the license server.
 *
 * These used to be two jobs thirty minutes apart (`license-refresh` at 02:00,
 * `update-check` at 02:30), which meant two wake-ups, two schedules to keep in
 * sync, and two separate calls to the same server for what is one exchange.
 *
 * Order matters: the entitlement refresh runs FIRST and unconditionally, because
 * `processUpdateCheck` returns early when no account token is stored, while
 * manual-key licenses still have to refresh through `/activate`. Running the
 * update check first would skip the refresh entirely on those installs.
 *
 * A refresh failure must not cost the update check: `refreshLicense` already
 * applies the grace window internally, and anything that escapes it is logged
 * and swallowed here so the second half still runs.
 *
 * ⚠ The CORE check is a third, independent step, and it runs whatever the other
 * two do. `processUpdateCheck` returns early without an account token; core
 * asks anonymously, because an install that never connected an account is the
 * one most likely to be running an un-patched forum.
 *
 * The ANNOUNCEMENT check is a fourth, on the same anonymous terms and for the
 * same reason — a broadcast that only reached accounted installs would miss
 * precisely the administrators a warning is aimed at.
 */
export async function processMarketplaceSync(): Promise<void> {
  const { refreshLicense } = await import("../core/license-engine/license-engine.js");
  await refreshLicense().catch((err) => {
    logger.warn({ err }, "License refresh failed during marketplace sync — grace period applies");
  });
  await processUpdateCheck();

  const { processCoreUpdateCheck } = await import("./coreUpdateCheck.js");
  await processCoreUpdateCheck().catch((err) => {
    logger.warn({ err }, "Core update check failed during marketplace sync");
  });

  const { processAnnouncementCheck } = await import("./announcementCheck.js");
  await processAnnouncementCheck().catch((err) => {
    logger.warn({ err }, "Announcement check failed during marketplace sync");
  });
}

export function startUpdateCheckWorker() {
  return new Worker(
    "update-check",
    async () => {
      await processMarketplaceSync();
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}
