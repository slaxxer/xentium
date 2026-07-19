import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { prisma } from "../infrastructure/db.js";
import { env } from "../config/env.js";
import { bustSettingsCache } from "../shared/utils/settings.js";
import { logger } from "../infrastructure/logging/logger.js";

/**
 * §16 daily update check-in: report the installed plugin inventory to the
 * marketplace and cache what came back (newer versions, critical flags,
 * renewalRequired). The ACP reads the cache — this is how customers see
 * renewal warnings and critical updates BEFORE something stops working.
 * The same call feeds the marketplace's per-site inventory view.
 */
const UPDATES_SETTING = "marketplace.updates";

export async function processUpdateCheck(): Promise<void> {
  // Dev licensing signs locally — there is no server to ask.
  if (env.LICENSE_DEV_PRIVATE_KEY) return;

  const tokenRow = await prisma.setting.findUnique({ where: { key: "marketplace.nodevo.io.token" } });
  const token = (tokenRow?.value as string | null) ?? null;
  if (!token) return; // no connected account — nothing to check against

  // Keep the authoritative paid-plugin-id set fresh (drives the license-by-id gate).
  const { marketplaceSource } = await import("../core/license-engine/marketplace-source.js");
  await marketplaceSource.refreshPaidPluginIds().catch(() => {});

  const plugins = await prisma.installedPlugin.findMany({
    select: { id: true, name: true, installedVersion: true },
  });

  const res = await fetch(`${env.LICENSE_SERVER_URL}/marketplace/updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      installed: plugins.map((p) => ({ pluginId: p.id, version: p.installedVersion })),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) {
    logger.warn({ status: res?.status ?? "unreachable" }, "Marketplace update check failed — keeping last cache");
    return;
  }

  const body = await res.json() as { updates: { pluginId: string; latestVersion?: string }[] };
  // Enrich with what only this instance knows: the display name and the
  // version currently installed — the ACP renders "Forum 1.0.3 → 1.0.4".
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const updates = (body.updates ?? []).map((u) => ({
    ...u,
    name:             byId.get(u.pluginId)?.name ?? u.pluginId,
    installedVersion: byId.get(u.pluginId)?.installedVersion ?? null,
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

  const value = JSON.stringify({ checkedAt: new Date().toISOString(), setSince, updates });
  await prisma.setting.upsert({
    where:  { key: UPDATES_SETTING },
    update: { value },
    create: { key: UPDATES_SETTING, value },
  });
  bustSettingsCache(UPDATES_SETTING);

  logger.info({ installed: plugins.length, updates: (body.updates ?? []).length }, "Marketplace update check completed");
}

export function startUpdateCheckWorker() {
  return new Worker(
    "update-check",
    async () => {
      await processUpdateCheck();
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}
