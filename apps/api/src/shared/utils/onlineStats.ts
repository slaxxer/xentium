/**
 * Guests on the site, and the most visitors ever online at once.
 *
 * Members are counted by `online:users` (written on every authenticated request). A
 * guest has no id, so the footer's own poll stands in for one: each guest becomes a
 * KEYED HASH of their IP and browser — never the IP itself — in `online:guests`, with
 * the same window. Crawlers are not visitors and are left out.
 *
 * The record is members + guests (as forums count it), kept in Redis for the cheap
 * compare on every poll and mirrored to `xcf_settings` so it survives a Redis flush.
 */
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";
import { ONLINE_TTL_MS } from "../middleware/requireAuth.js";

const GUESTS = () => rkey("online:guests");
const RECORD = () => rkey("online:record");
const RECORD_SETTING = "online.record";
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|curl|wget|python|httpclient/i;

export interface OnlineRecord { count: number; at: string }

/**
 * Note a guest as here now. The footer polls only once sign-in has resolved, so a
 * member always arrives with their token and is never counted here as well.
 */
export async function touchGuest(req: Request): Promise<void> {
  if (req.userId) return;
  const ua = req.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return;
  const id = createHmac("sha256", env.COOKIE_SECRET).update(`${req.ip ?? ""}\n${ua}`).digest("base64url").slice(0, 22);
  await redis.zadd(GUESTS(), Date.now(), id).catch(() => {});
}

/** Guests seen inside the window. Fails closed (0). */
export async function countGuests(): Promise<number> {
  try {
    const since = Date.now() - ONLINE_TTL_MS;
    await redis.zremrangebyscore(GUESTS(), 0, since);
    return await redis.zcount(GUESTS(), since, "+inf");
  } catch {
    return 0;
  }
}

const parse = (v: unknown): OnlineRecord | null => {
  const r = (typeof v === "string" ? safeJson(v) : v) as Partial<OnlineRecord> | null;
  return r && typeof r.count === "number" && typeof r.at === "string" ? { count: r.count, at: r.at } : null;
};
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

/** The record so far: Redis first, the stored setting when Redis has lost it. */
export async function getRecord(): Promise<OnlineRecord | null> {
  const cached = parse(await redis.get(RECORD()).catch(() => null));
  if (cached) return cached;
  const row = await prisma.setting.findUnique({ where: { key: RECORD_SETTING } });
  const stored = parse(row?.value);
  if (stored) await redis.set(RECORD(), JSON.stringify(stored)).catch(() => {});
  return stored;
}

/** Compare `now` with the record and keep it when beaten. Returns the record after. */
export async function noteRecord(now: number): Promise<OnlineRecord | null> {
  const record = await getRecord();
  if (now <= 0 || (record && now <= record.count)) return record;
  const next: OnlineRecord = { count: now, at: new Date().toISOString() };
  await redis.set(RECORD(), JSON.stringify(next)).catch(() => {});
  await prisma.setting.upsert({
    where:  { key: RECORD_SETTING },
    update: { value: next as unknown as object },
    create: { key: RECORD_SETTING, value: next as unknown as object },
  });
  return next;
}
