import * as jose from "jose";
import type { CryptoKey } from "jose";
import { prisma } from "../infrastructure/db.js";
import type { Prisma } from "../generated/prisma/client.js";
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

/**
 * Ids of announcements an admin has read, and nothing else — no who, no when.
 *
 * An announcement is gone from this site the moment one admin clicks OK. But
 * the marketplace keeps serving it until it expires or is pulled, so without
 * this list the next check would bring it straight back. Each id is dropped
 * again as soon as the marketplace stops serving it: the list never outlives
 * the announcements it names.
 */
export const DISMISSED_SETTING = "announcements.dismissed";

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

type Db = Pick<Prisma.TransactionClient, "setting" | "$executeRaw">;

async function readJson<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    const value = row.value;
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return null;
  }
}

async function writeJson(db: Db, key: string, data: unknown): Promise<void> {
  const value = JSON.stringify(data);
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  bustSettingsCache(key);
}

export async function readAnnouncementCache(db: Db = prisma): Promise<AnnouncementCache | null> {
  return readJson<AnnouncementCache>(db, ANNOUNCEMENTS_SETTING);
}

export async function readDismissed(db: Db = prisma): Promise<string[]> {
  const ids = await readJson<unknown>(db, DISMISSED_SETTING);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Run `fn` holding the announcement lock. The check job and an admin's OK both
 * read and rewrite the cache and the dismissed list; without this, a check that
 * started before the click would write the notice back and drop its id.
 */
export async function withAnnouncementLock<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('xentium.announcements'))`;
    return fn(tx);
  });
}

/**
 * An admin read it: it leaves this site for every admin, and only its id stays
 * behind, until the marketplace stops serving it.
 */
export async function dismissAnnouncement(id: string): Promise<void> {
  await withAnnouncementLock(async (db) => {
    const cache = await readAnnouncementCache(db);
    if (!cache?.announcements.some((a) => a.id === id)) return;
    await writeJson(db, ANNOUNCEMENTS_SETTING, {
      ...cache,
      announcements: cache.announcements.filter((a) => a.id !== id),
    } satisfies AnnouncementCache);
    const dismissed = await readDismissed(db);
    await writeJson(db, DISMISSED_SETTING, [...new Set([...dismissed, id])]);
  });
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

  const shown = await withAnnouncementLock(async (db) => {
    const served = new Set(verified.map((a) => a.id));
    const dismissed = await readDismissed(db);
    const stillServed = dismissed.filter((id) => served.has(id));
    const shown = verified.filter((a) => !dismissed.includes(a.id));

    await writeJson(db, ANNOUNCEMENTS_SETTING, {
      checkedAt: new Date().toISOString(),
      announcements: shown,
    } satisfies AnnouncementCache);
    if (stillServed.length !== dismissed.length) await writeJson(db, DISMISSED_SETTING, stillServed);
    return shown.length;
  });

  logger.info({ announcements: shown }, "Announcement check completed");
}
