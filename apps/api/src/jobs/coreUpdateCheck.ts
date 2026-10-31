import { prisma } from "../infrastructure/db.js";
import { env } from "../config/env.js";
import { XENTIUM_VERSION } from "../config/version.js";
import { bustSettingsCache } from "../shared/utils/settings.js";
import { logger } from "../infrastructure/logging/logger.js";

/**
 * Is there a newer Xentium?
 *
 * ⚠ This is a SIBLING of the plugin heartbeat, not a part of it. The heartbeat
 * returns early when no account token is stored — correctly, because there are
 * no entitlements to ask about — and an install that never connected an account
 * is exactly the one most likely to be running an un-patched forum. Folding the
 * core check in there would mean the sites that most need to hear about a
 * security release are the only ones that never do.
 *
 * So: no token, no signature, no site id, no inventory. We send the version we
 * are on and nothing else, and the marketplace learns nothing about who asked.
 * That is also what makes the endpoint cacheable enough to be called by every
 * install in the world once a day.
 *
 * Never throws. A core check that fails is a logged line and yesterday's cache,
 * the same rule as everything else in ADR-0001: a site behind on updates keeps
 * running.
 */

export const CORE_UPDATE_SETTING = "core.update";

export type CoreSeverity = "normal" | "security" | "critical";

export interface CoreReleaseInfo {
  version: string;
  severity: CoreSeverity;
  publishedAt: string | null;
  notes: string | null;
  upgradeNotes: string | null;
  minUpgradeFrom: string | null;
}

/** What we cache, and what the ACP reads. */
export interface CoreUpdateCache {
  checkedAt: string;
  /**
   * When THIS pending update first appeared. Stable across re-checks that find
   * the same thing, which is what makes a per-admin acknowledgement stick —
   * see the same anchor in the plugin cache.
   */
  setSince: string;
  /** What we were running when we asked. */
  current: string;
  latest: CoreReleaseInfo | null;
  updateAvailable: boolean;
  path: CoreReleaseInfo[];
  highestSeverity: CoreSeverity | null;
  /** The newest release on our own minor — an auto-applicable patch. */
  patch: CoreReleaseInfo | null;
  /** Set when `latest` cannot be reached directly: install this first. */
  via: string | null;
}

/** `https://app.xentium.org/api/p/xentium-store/v1` → the core endpoint on the same protocol version. */
function coreLatestUrl(from: string): string {
  const base = env.LICENSE_SERVER_URL.replace(/\/+$/, "");
  return `${base}/core/latest?channel=stable&from=${encodeURIComponent(from)}`;
}

/**
 * The anchor only moves when the OFFER changes. Re-checking every day and
 * finding the same release must not re-nudge an admin who has already looked.
 * A release the team later marks as a security fix IS a new offer: the admin
 * looked at a feature release and has not been told about the vulnerability.
 */
export function anchorFor(
  previous: CoreUpdateCache | null,
  latestVersion: string | null,
  highestSeverity: CoreSeverity | null,
  now = new Date(),
): string {
  const unchanged = previous
    && (previous.latest?.version ?? null) === latestVersion
    && (previous.highestSeverity ?? null) === highestSeverity;
  return unchanged && previous.setSince ? previous.setSince : now.toISOString();
}

export async function readCoreUpdateCache(): Promise<CoreUpdateCache | null> {
  const row = await prisma.setting.findUnique({ where: { key: CORE_UPDATE_SETTING } });
  if (!row) return null;
  try {
    const value = row.value;
    return (typeof value === "string" ? JSON.parse(value) : value) as CoreUpdateCache;
  } catch {
    return null;
  }
}

export async function processCoreUpdateCheck(): Promise<void> {
  const current = XENTIUM_VERSION;

  interface LatestResponse {
    latest: CoreReleaseInfo | null;
    updateAvailable: boolean;
    path: CoreReleaseInfo[];
    highestSeverity: CoreSeverity | null;
    patch: CoreReleaseInfo | null;
    via: string | null;
  }

  let body: LatestResponse;
  try {
    const response = await fetch(coreLatestUrl(current), {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = (await response.json()) as LatestResponse;
  } catch (err) {
    logger.warn({ err }, "Core update check failed — keeping last cache");
    return;
  }

  const previous = await readCoreUpdateCache();
  const cache: CoreUpdateCache = {
    checkedAt: new Date().toISOString(),
    setSince: anchorFor(previous, body.latest?.version ?? null, body.highestSeverity ?? null),
    current,
    latest: body.latest ?? null,
    updateAvailable: body.updateAvailable === true,
    path: body.path ?? [],
    highestSeverity: body.highestSeverity ?? null,
    patch: body.patch ?? null,
    via: body.via ?? null,
  };

  const value = JSON.stringify(cache);
  await prisma.setting.upsert({
    where:  { key: CORE_UPDATE_SETTING },
    update: { value },
    create: { key: CORE_UPDATE_SETTING, value },
  });
  bustSettingsCache(CORE_UPDATE_SETTING);

  logger.info(
    { current, latest: cache.latest?.version ?? null, severity: cache.highestSeverity },
    "Core update check completed",
  );
}
