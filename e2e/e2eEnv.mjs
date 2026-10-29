/**
 * The environment the e2e stack runs in, and the guard that keeps it off real data.
 *
 * `pnpm e2e` resets its database before every run. It used to reset whatever
 * DATABASE_URL in the root .env named (the development database), and Playwright
 * happily reused a dev stack already running on 5173/4000. Now the suite gets its
 * own everything, so a run can't touch the dev site at all:
 *
 *   database   <devdb>_e2e when that database is on this machine; anywhere else only
 *              an explicit E2E_DATABASE_URL (which must also end in _e2e/_test).
 *              Never with NODE_ENV=production.
 *   ports      web 5175, API 4300
 *   uploads    apps/api/var/e2e-uploads
 *   redis      keys under "xentium-e2e:", so the e2e worker never takes dev jobs
 *   marketplace none (an address that refuses), so nothing live leaks in
 *
 * Both scripts/e2e.mjs (the reset) and playwright.config.ts (the stack it boots)
 * read from here, so they can't disagree about which database they mean.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_WEB_PORT = 5175;
export const E2E_API_PORT = 4300;
/** Relative to apps/api, like the dev UPLOAD_DIR. */
export const E2E_UPLOAD_DIR = "./var/e2e-uploads";
const SUFFIXES = ["_e2e", "_test"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function rootEnv() {
  try {
    return parseEnv(readFileSync(resolve(REPO_ROOT, ".env"), "utf8"));
  } catch {
    return {};
  }
}

export function databaseNameOf(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/** Throw unless the database is one the suite may destroy. */
export function assertE2eDatabase(url) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run e2e with NODE_ENV=production. The suite wipes its database.");
  }
  const name = url ? databaseNameOf(url) : null;
  if (name && SUFFIXES.some((s) => name.endsWith(s))) return;
  throw new Error(
    `Refusing to run e2e against database "${name ?? "<unknown>"}".\n` +
    `The suite wipes its database before every run, so it only uses one whose name\n` +
    `ends in ${SUFFIXES.join(" or ")}. By default that is your DATABASE_URL with "_e2e"\n` +
    `appended; set E2E_DATABASE_URL to point somewhere else.`,
  );
}

/**
 * The e2e database URL: E2E_DATABASE_URL, else the dev URL with "_e2e" appended,
 * but only when that server is this machine. A .env pointing at a remote server
 * (a staging or production box) never gets a database derived from it.
 */
export function e2eDatabaseUrl() {
  const explicit = process.env.E2E_DATABASE_URL;
  if (explicit) return explicit;
  const base = rootEnv().DATABASE_URL;
  if (!base) throw new Error("No DATABASE_URL in the root .env and no E2E_DATABASE_URL set.");
  const host = new URL(base).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at "${host}", not this machine, so pnpm e2e won't derive a\n` +
      `database from it. Set E2E_DATABASE_URL to a disposable *_e2e database.`,
    );
  }
  const name = databaseNameOf(base);
  if (!name) throw new Error("DATABASE_URL in the root .env has no database name.");
  if (SUFFIXES.some((s) => name.endsWith(s))) return base;
  const url = new URL(base);
  url.pathname = `/${name}_e2e`;
  return url.toString();
}

/** Every variable the e2e stack needs, checked. */
export function e2eEnv() {
  const databaseUrl = e2eDatabaseUrl();
  assertE2eDatabase(databaseUrl);
  return {
    DATABASE_URL: databaseUrl,
    PORT: String(E2E_API_PORT),
    APP_URL: `http://localhost:${E2E_WEB_PORT}`,
    UPLOAD_DIR: E2E_UPLOAD_DIR,
    REDIS_KEY_PREFIX: "xentium-e2e:",
    XT_WEB_PORT: String(E2E_WEB_PORT),
    XT_API_URL: `http://localhost:${E2E_API_PORT}`,
    // No marketplace. The default is the live one, so the suite used to read
    // whatever the team had announced that day: the alpha.20 announcement opened
    // over the ACP and broke three tests that never touched it. Port 9 (discard)
    // refuses at once, which the installer and the ACP already handle as
    // "marketplace unreachable".
    LICENSE_SERVER_URL: "http://127.0.0.1:9/api/v1",
  };
}
