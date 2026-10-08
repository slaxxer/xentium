/**
 * IP → country, looked up LOCALLY.
 *
 * The data is DB-IP's free "IP to Country Lite" database (CC BY 4.0 — the UI that
 * shows a country credits DB-IP, which the licence requires). It is downloaded to
 * `var/geoip` beside the uploads by the monthly `geoip-refresh` job; no member's IP
 * ever leaves this server to be looked up.
 *
 * Never throws: with no database yet (a fresh install before its first refresh, or
 * an offline box) every lookup answers `null` and the caller shows the IP alone.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Reader, type CountryResponse } from "maxmind";
import { env } from "../config/env.js";
import { logger } from "./logging/logger.js";

/** `var/geoip`, the uploads directory's sibling — data, but never served. */
export const GEOIP_DIR = path.join(path.dirname(path.resolve(env.UPLOAD_DIR)), "geoip");
export const GEOIP_FILE = path.join(GEOIP_DIR, "dbip-country-lite.mmdb");

/** The monthly file. DB-IP publishes `dbip-country-lite-YYYY-MM.mmdb.gz` early each month. */
export function dbipUrl(d: Date): string {
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `https://download.db-ip.com/free/dbip-country-lite-${ym}.mmdb.gz`;
}

let reader: Reader<CountryResponse> | null = null;
let loadedMtime = 0;

/** The open database, reopened when the refresh job has replaced the file. */
function current(): Reader<CountryResponse> | null {
  try {
    const { mtimeMs } = fs.statSync(GEOIP_FILE);
    if (!reader || mtimeMs !== loadedMtime) {
      reader = new Reader<CountryResponse>(fs.readFileSync(GEOIP_FILE));
      loadedMtime = mtimeMs;
    }
    return reader;
  } catch {
    return null; // no database yet
  }
}

/** ISO 3166-1 alpha-2 country code ("DE"), or null when unknown / private / no database. */
export function countryOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const db = current();
  if (!db) return null;
  try {
    return db.get(ip)?.country?.iso_code ?? null;
  } catch {
    return null; // not an IP the database understands
  }
}

/** Whether lookups can answer at all — the UI says so instead of showing blanks. */
export function geoipAvailable(): boolean {
  return current() !== null;
}

/**
 * Fetch this month's database (falling back to last month's in the first days, before
 * the new file is published), verify it opens, and swap it in atomically.
 */
export async function refreshGeoip(now = new Date()): Promise<{ url: string; bytes: number }> {
  await fsp.mkdir(GEOIP_DIR, { recursive: true });
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  let lastError: unknown = null;
  for (const url of [dbipUrl(now), dbipUrl(prev)]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const tmp = `${GEOIP_FILE}.download`;
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), zlib.createGunzip(), fs.createWriteStream(tmp));
      // Refuse a file that is not a database before it replaces a working one.
      const buf = await fsp.readFile(tmp);
      new Reader<CountryResponse>(buf);
      await fsp.rename(tmp, GEOIP_FILE);
      logger.info({ url, bytes: buf.length }, "[geoip] database refreshed");
      return { url, bytes: buf.length };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`GeoIP refresh failed: ${(lastError as Error)?.message ?? lastError}`);
}
