import { createHash } from "node:crypto";
import type { PaginatedRequest } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { getSetting } from "../../shared/utils/settings.js";
import { compareSemver } from "../../shared/utils/semver.js";
import { marketplaceSource } from "../../core/license-engine/marketplace-source.js";
import {
  getSiteDomain, getSiteId, resolveEnvironment,
  refreshLicense, activateFromAccount,
} from "../../core/license-engine/license-engine.js";
import { processUpdateCheck } from "../../jobs/updateCheck.js";
import { pluginService } from "../plugins/plugin.service.js";
import { activityService } from "../activity/activity.service.js";
import { adminService } from "./admin.service.js";

/** One coarse step in the install/update progress stream (0..100 overall). */
export interface UpdateProgress { phase: string; percent: number; message?: string }
export type ProgressFn = (p: UpdateProgress) => void;

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const EXPIRING_SOON_DAYS = 30;

/** Download/verify failure carrying the HTTP status the caller should send. */
export class ArtifactError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Chokepoint: authorize the download for this site, stream the package (120s /
 * 50 MB cap, reporting byte progress), sha256-verify, and confirm the manifest id
 * matches the requested plugin. Reports coarse progress (authorizing → downloading
 * → verifying → validating, ~5..75%). Throws ArtifactError(status) on failure;
 * returns the verified buffer on success.
 */
async function downloadAndVerifyArtifact(pluginId: string, version: string, onProgress?: ProgressFn): Promise<Buffer> {
  onProgress?.({ phase: "authorizing", percent: 5 });
  const authorized = await marketplaceSource.authorizeDownload({
    pluginId, version,
    siteId:      await getSiteId(),
    domain:      await getSiteDomain(),
    environment: await resolveEnvironment(),
  });
  if (!authorized.downloadUrl) {
    // Dev catalogue / community sources have no hosted artifact — manual upload path.
    throw new ArtifactError("This source has no downloadable artifact. Upload the package manually.", 400);
  }

  onProgress?.({ phase: "downloading", percent: 10 });
  const dl = await fetch(authorized.downloadUrl, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!dl?.ok || !dl.body) {
    throw new ArtifactError(`Artifact download failed (${dl?.status ?? "unreachable"}). Try again.`, 502);
  }

  // Stream the body so the bar reflects real bytes (10..65% of the overall bar).
  const total  = Number(dl.headers.get("content-length") ?? 0);
  const reader = dl.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received > MAX_ARTIFACT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ArtifactError("Artifact exceeds the 50 MB package limit.", 502);
    }
    onProgress?.({
      phase:   "downloading",
      percent: total ? 10 + Math.round((received / total) * 55) : 15,
      message: total ? undefined : `${Math.round(received / 1024)} KB`,
    });
  }
  const buffer = Buffer.concat(chunks);

  onProgress?.({ phase: "verifying", percent: 70 });
  if (authorized.sha256) {
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== authorized.sha256) {
      throw new ArtifactError("Artifact integrity check failed (sha256 mismatch). Nothing was installed.", 502);
    }
  }

  onProgress?.({ phase: "validating", percent: 75 });
  // Validate first so a mismatched package (manifest id ≠ requested plugin) is
  // rejected before any install/update step touches the running instance.
  const info = await pluginService.validateOnly(buffer);
  if (info.id !== pluginId) {
    throw new ArtifactError(`Package manifest id "${info.id}" does not match the requested plugin.`, 502);
  }

  return buffer;
}

interface CachedUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical?:         boolean;
  renewalRequired?:  boolean;
  [k: string]:       unknown;
}

/**
 * Read the `marketplace.updates` cache and RECONCILE it against what's actually
 * installed right now. The cache is only refreshed by the update-check job, so a
 * plugin uninstalled (or already updated) since the last run would otherwise leave
 * a phantom "update available" alert on the ACP. An update survives only if its
 * plugin is still installed AND its current installed version is older than the
 * offered version; the installed version is refreshed for accurate display.
 */
async function readReconciledUpdates(): Promise<{ checkedAt: string | null; setSince?: string; updates: CachedUpdate[] }> {
  const raw = await getSetting<string>("marketplace.updates", "");
  if (!raw) return { checkedAt: null, updates: [] };

  let parsed: { checkedAt?: string | null; setSince?: string; updates?: CachedUpdate[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { checkedAt: null, updates: [] };
  }

  const cached = Array.isArray(parsed.updates) ? parsed.updates : [];
  if (!cached.length) return { checkedAt: parsed.checkedAt ?? null, setSince: parsed.setSince, updates: [] };

  const installed = await prisma.installedPlugin.findMany({ select: { id: true, installedVersion: true } });
  const byId = new Map(installed.map((p) => [p.id, p.installedVersion]));

  const updates = cached
    .filter((u) => {
      const current = byId.get(u.pluginId);
      return current !== undefined && compareSemver(u.latestVersion, current) > 0;
    })
    .map((u) => ({ ...u, installedVersion: byId.get(u.pluginId) ?? u.installedVersion }));

  return { checkedAt: parsed.checkedAt ?? null, setSince: parsed.setSince, updates };
}

export const marketplaceService = {
  listPlugins(opts: PaginatedRequest) {
    return marketplaceSource.listPlugins(opts);
  },

  getConnection() {
    return marketplaceSource.getConnection();
  },

  /** Connect the marketplace account, then best-effort auto-activate its license
   *  (§53: manual key entry is the offline fallback — an account without a usable
   *  license connects fine and activates later via refresh/retry). */
  async connect(authCode: string) {
    const connection = await marketplaceSource.connect(authCode);
    let licenseActivated = false;
    try {
      licenseActivated = await activateFromAccount();
    } catch (err) {
      logger.info({ err }, "Marketplace connected; no license auto-activated");
    }
    return { ...connection, licenseActivated };
  },

  disconnect() {
    return marketplaceSource.disconnect();
  },

  /** The authenticated download gate — verifies account + per-domain ownership and
   *  returns a fresh domain-bound entitlement for this site. */
  async authorizeDownload(pluginId: string, version: string) {
    return marketplaceSource.authorizeDownload({
      pluginId,
      version,
      siteId:      await getSiteId(),
      domain:      await getSiteDomain(),
      environment: await resolveEnvironment(),
    });
  },

  /**
   * Cache written by the daily update-check job (§16) — updates, critical flags,
   * renewal warnings — reconciled against currently-installed plugins. Null
   * checkedAt = the job has never completed. `acknowledged` = has THIS admin
   * visited /admin/updates since the current pending set appeared (setSince);
   * the ACP-entry dialog uses it to stay visible per-admin until they actually
   * engage — not just dismiss it.
   */
  async getUpdates(userId?: string) {
    const { checkedAt, setSince, updates } = await readReconciledUpdates();

    // No pending updates → nothing to acknowledge. A missing setSince (pre-anchor
    // cache) is treated as unacknowledged so the dialog still nudges until the next
    // update-check writes the anchor.
    let acknowledged = true;
    if (updates.length && userId) {
      acknowledged = setSince
        ? await activityService.hasVisitedSince(userId, "/admin/updates", new Date(setSince))
        : false;
    }
    return { checkedAt, setSince, updates, acknowledged };
  },

  /**
   * Aggregated "admin attention" signals for the frontend navbar ACP badge.
   * Persists (count > 0) until the work is done: pending plugin updates until
   * they're applied, plus the license when it's about to expire (or has). Kept
   * deliberately small + server-side so the badge stays a dumb consumer and new
   * signals (core update, stuck jobs, …) can be OR-ed in here later.
   */
  async getStatusSummary(userId?: string) {
    // Pending plugin updates — reconciled so an uninstalled/already-updated
    // plugin never inflates the badge from a stale cache.
    const { updates } = await readReconciledUpdates();
    const pluginUpdates = updates.length;
    const criticalUpdate = updates.some((u) => u.critical);

    // License expiry.
    let licenseExpiringSoon = false;
    let licenseExpired = false;
    let licenseDaysLeft: number | null = null;
    const license = await adminService.getActiveLicense();
    if (license?.expiresAt) {
      const daysLeft = (new Date(license.expiresAt).getTime() - Date.now()) / 86_400_000;
      licenseDaysLeft = Math.ceil(daysLeft);
      if (daysLeft <= 0) licenseExpired = true;
      else if (daysLeft <= EXPIRING_SOON_DAYS) licenseExpiringSoon = true;
    }
    const licenseAttention = licenseExpiringSoon || licenseExpired;

    // Per-admin acknowledgement for the license-expiry dialog: has THIS admin
    // visited /admin/license since the license entered the warning window
    // (expiresAt − 30d)? That anchor is stable for the term and moves forward on
    // renewal, so the dialog re-nudges each cycle. Same visit-based model as the
    // update dialog (a dismissal never counts; only looking does).
    let licenseAcknowledged = true;
    if (licenseAttention && userId && license?.expiresAt) {
      const anchor = new Date(new Date(license.expiresAt).getTime() - EXPIRING_SOON_DAYS * 86_400_000);
      licenseAcknowledged = await activityService.hasVisitedSince(userId, "/admin/license", anchor);
    }

    return {
      pluginUpdates,
      criticalUpdate,
      licenseExpiringSoon,
      licenseExpired,
      licenseDaysLeft,
      licenseExpiresAt:   license?.expiresAt ? new Date(license.expiresAt).toISOString() : null,
      licenseDomain:      license?.domain ?? null,
      licenseAcknowledged,
      // Badge count: each pending update + the license (once) if it needs attention.
      total: pluginUpdates + (licenseAttention ? 1 : 0),
      // Red vs neutral badge.
      urgent: criticalUpdate || licenseAttention,
    };
  },

  /**
   * Direct install (§16.2): authorize at the chokepoint, fetch the artifact
   * server-side (the account token never reaches the browser), verify its sha256,
   * then run the SAME intake as a manual upload. Lands installed but DISABLED —
   * enabling stays an explicit admin action. Download-phase failures throw
   * ArtifactError (carrying the HTTP status); install-phase errors propagate.
   */
  async installFromMarketplace(pluginId: string, version: string, userId: string) {
    let buffer: Buffer;
    try {
      buffer = await downloadAndVerifyArtifact(pluginId, version);
    } catch (err) {
      if (err instanceof ArtifactError) throw err;
      throw new ArtifactError(err instanceof Error ? err.message : "Artifact download failed.", 502);
    }

    const manifest = await pluginService.install(buffer, userId);
    // A just-bought plugin isn't in the STORED entitlement JWT yet (it only
    // refreshes monthly) — refresh now so Enable works immediately instead
    // of failing NEC-LICENSE-9001 until the daily job. Best-effort.
    await refreshLicense().catch(() => {});
    // Refresh the update cache so a newly-installed (older) build surfaces its
    // available update right away, instead of waiting for the daily job.
    // Fire-and-forget — the admin sees it on their next ACP entry.
    void processUpdateCheck().catch(() => {});
    return { id: manifest.id, name: manifest.name, version: manifest.version };
  },

  /** §16.2 update-in-place: download+verify (byte progress), then swap/migrate/
   *  re-enable via the plugin engine. Progress events flow through onProgress;
   *  errors propagate to the caller (the controller turns them into a terminal
   *  stream event — headers are already sent by then). */
  async updateFromMarketplace(pluginId: string, version: string, userId: string, onProgress?: ProgressFn) {
    const buffer = await downloadAndVerifyArtifact(pluginId, version, onProgress);
    const manifest = await pluginService.update(buffer, userId, onProgress);
    return { id: manifest.id, name: manifest.name, version: manifest.version };
  },
};
