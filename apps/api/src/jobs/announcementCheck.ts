import * as jose from "jose";
import type { CryptoKey } from "jose";
import { prisma } from "../infrastructure/db.js";
import { env } from "../config/env.js";
import { bustSettingsCache } from "../shared/utils/settings.js";
import { logger } from "../infrastructure/logging/logger.js";
import { getMarketplacePublicKey } from "../core/license-engine/license-engine.js";

/**
 * Broadcasts from the Xentium team.
 *
 * A SIBLING of the core update check, and anonymous for the same reason: the
 * plugin heartbeat returns early without an account token, and an install that
 * never connected one is exactly the install that most needs to hear "there is
 * a phishing campaign using our name". No token, no signature, no site id, no
 * inventory — the marketplace learns nothing about who asked, and there is
 * deliberately no read receipt.
 *
 * ⚠ Every announcement arrives as a SIGNED JWT and is discarded unless it
 * verifies against the marketplace's public key — the same key that signs
 * entitlements, which this instance already bundles. This is the one channel in
 * the product where a stranger's prose is rendered in a modal in front of an
 * administrator, so "the license server said so" is not good enough: anyone who
 * can answer for that host (a proxy, a DNS hijack, a mis-pointed
 * LICENSE_SERVER_URL) would otherwise be able to put words in our mouth in the
 * most trusted surface we have.
 *
 * Never throws. A failed check is a logged line and yesterday's cache — the
 * same rule as everything else in ADR-0001.
 */

export const ANNOUNCEMENTS_SETTING = "announcements";

export type AnnouncementSeverity = "info" | "important" | "critical";

export interface AnnouncementCopy {
  title: string;
  body: string;
}

/** One verified broadcast, as the ACP reads it. */
export interface Announcement {
  id: string;
  severity: AnnouncementSeverity;
  publishedAt: string;
  expiresAt: string | null;
  link: string | null;
  /** Every locale the team translated, English always present. */
  locales: Record<string, AnnouncementCopy>;
}

export interface AnnouncementCache {
  checkedAt: string;
  announcements: Announcement[];
}

const SEVERITIES: AnnouncementSeverity[] = ["info", "important", "critical"];

/** `https://plugins.xentium.org/api/v1` → the broadcast endpoint beside it. */
function announcementsUrl(): string {
  return `${env.LICENSE_SERVER_URL.replace(/\/+$/, "")}/announcements`;
}

export async function readAnnouncementCache(): Promise<AnnouncementCache | null> {
  const row = await prisma.setting.findUnique({ where: { key: ANNOUNCEMENTS_SETTING } });
  if (!row) return null;
  try {
    const value = row.value;
    return (typeof value === "string" ? JSON.parse(value) : value) as AnnouncementCache;
  } catch {
    return null;
  }
}

/**
 * Verify one JWT and turn it into something renderable.
 *
 * Returns null for anything that does not verify, has expired, or does not
 * carry the shape we expect. Nothing here is lenient: a malformed announcement
 * is dropped rather than shown with the odd field missing, because a modal that
 * renders half of an attacker's payload is still a modal that rendered it.
 *
 * `jwtVerify` enforces `exp` itself, which is why the expiry lives in the
 * signature — one rule, checked by the thing that already has to be right.
 */
async function verify(token: string, key: CryptoKey): Promise<Announcement | null> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["RS256"] });
    claims = payload as Record<string, unknown>;
  } catch {
    return null;
  }

  const id = typeof claims.id === "string" ? claims.id : null;
  const publishedAt = typeof claims.publishedAt === "string" ? claims.publishedAt : null;
  if (!id || !publishedAt) return null;

  const severity = SEVERITIES.includes(claims.severity as AnnouncementSeverity)
    ? (claims.severity as AnnouncementSeverity)
    : "info";

  // https only, and parsed rather than pattern-matched: this string becomes an
  // anchor in the admin panel, and `javascript:` in front of an administrator
  // is the whole reason this channel is signed in the first place.
  let link: string | null = null;
  if (typeof claims.link === "string" && claims.link) {
    try {
      const url = new URL(claims.link);
      if (url.protocol === "https:") link = url.toString();
    } catch { /* not a URL — drop it, keep the announcement */ }
  }

  const locales: Record<string, AnnouncementCopy> = {};
  const raw = claims.locales;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const copy = value as { title?: unknown; body?: unknown };
      if (typeof copy.title !== "string" || typeof copy.body !== "string") continue;
      if (!copy.title.trim() || !copy.body.trim()) continue;
      locales[locale] = { title: copy.title, body: copy.body };
    }
  }
  // English is the fallback every instance can read. Without it there is no
  // guarantee this install can render the thing at all.
  if (!locales.en) return null;

  return {
    id,
    severity,
    publishedAt,
    expiresAt: typeof claims.expiresAt === "string" ? claims.expiresAt : null,
    link,
    locales,
  };
}

export async function processAnnouncementCheck(): Promise<void> {
  interface Response { announcements?: unknown }

  let body: Response;
  try {
    const res = await fetch(announcementsUrl(), {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Announcement check failed — keeping last cache");
      return;
    }
    body = (await res.json()) as Response;
  } catch (err) {
    logger.warn({ err }, "Announcement check failed — keeping last cache");
    return;
  }

  const tokens = Array.isArray(body.announcements)
    ? body.announcements.filter((t): t is string => typeof t === "string")
    : [];

  let key: CryptoKey;
  try {
    key = await getMarketplacePublicKey();
  } catch (err) {
    logger.warn({ err }, "Announcement check: no verification key — keeping last cache");
    return;
  }

  const verified: Announcement[] = [];
  let rejected = 0;
  for (const token of tokens) {
    const announcement = await verify(token, key);
    if (announcement) verified.push(announcement);
    else rejected += 1;
  }

  if (rejected > 0) {
    // Worth a line of its own. One rejection is an expired notice; a response
    // where everything fails to verify is someone else answering for the
    // marketplace, and an operator reading logs should be able to tell.
    logger.warn(
      { rejected, accepted: verified.length },
      "Announcements rejected — signature, expiry or shape",
    );
  }

  // Newest first, so the ACP shows the most recent thing first without sorting.
  verified.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const value = JSON.stringify({
    checkedAt: new Date().toISOString(),
    announcements: verified,
  } satisfies AnnouncementCache);

  await prisma.setting.upsert({
    where:  { key: ANNOUNCEMENTS_SETTING },
    update: { value },
    create: { key: ANNOUNCEMENTS_SETTING, value },
  });
  bustSettingsCache(ANNOUNCEMENTS_SETTING);

  logger.info({ announcements: verified.length }, "Announcement check completed");
}
