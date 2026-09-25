/**
 * The worker's boot gate reads `process.env` before anything loads the .env file.
 *
 * This is pinned because getting it wrong is silent and total: the worker waits
 * for a schema it cannot see, systemd reports the unit as "active", the site
 * looks fine because the API has its own dotenv call — and no scheduled job runs
 * at all. It stranded app.xentium.org for six days before anyone noticed, and
 * the only symptom was one log line claiming to be waiting for an installer that
 * had finished long before.
 *
 * The condition that causes it is exactly an npm install: systemd passes
 * XENTIUM_ENV_FILE and NOTHING else, so a complete env file means the
 * setup-mode branch — the only thing that used to call
 * `loadEnvFileIntoProcess` — never runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const KEYS = ["DATABASE_URL", "COOKIE_SECRET", "JWT_SECRET", "DUMMY_ARGON2_HASH", "XENTIUM_ENV_FILE"];

let saved: Record<string, string | undefined> = {};
let dir: string;

beforeEach(async () => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  dir = await mkdtemp(path.join(tmpdir(), "xt-worker-env-"));
  // envProbe resolves ENV_FILE_PATH once, at module load, from
  // XENTIUM_ENV_FILE. Each test points at its own file, so the module has to be
  // re-evaluated or every test after the first reads the first one's path.
  vi.resetModules();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(dir, { recursive: true, force: true });
});

/** The env a real npm install has: a path, and nothing else. */
async function npmInstallEnv() {
  const file = path.join(dir, ".env");
  await writeFile(file, [
    'DATABASE_URL="postgresql://u:p@localhost:5432/xentium"',
    'COOKIE_SECRET="0123456789abcdef0123456789abcdef"',
    'JWT_SECRET="0123456789abcdef0123456789abcdef0123456789abcdef"',
    'DUMMY_ARGON2_HASH="$argon2id$v=19$m=65536,t=3,p=4$abc$def"',
  ].join("\n"), "utf8");
  process.env.XENTIUM_ENV_FILE = file;
  return file;
}

describe("worker boot env", () => {
  it("sees a complete env file, so the setup-mode wait is skipped", async () => {
    await npmInstallEnv();
    const { missingRequiredEnv } = await import("./config/envProbe.js");
    expect(missingRequiredEnv()).toEqual([]);
  });

  it("has NO DATABASE_URL in process.env until the file is loaded", async () => {
    // The bug in one line: the probe above is satisfied by the FILE, while the
    // schema check reads the VARIABLE — and systemd never set it.
    await npmInstallEnv();
    const { missingRequiredEnv } = await import("./config/envProbe.js");
    expect(missingRequiredEnv()).toEqual([]);
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("gets one once the file is loaded, which is what the gate must do first", async () => {
    await npmInstallEnv();
    const { loadEnvFileIntoProcess } = await import("./config/envProbe.js");
    loadEnvFileIntoProcess();
    expect(process.env.DATABASE_URL).toContain("postgresql://");
  });

  it("never overrides a variable systemd already set", async () => {
    // Which is why loading unconditionally is safe: an install that DOES pass
    // real environment variables keeps them.
    await npmInstallEnv();
    process.env.DATABASE_URL = "postgresql://real:real@db:5432/real";
    const { loadEnvFileIntoProcess } = await import("./config/envProbe.js");
    loadEnvFileIntoProcess();
    expect(process.env.DATABASE_URL).toBe("postgresql://real:real@db:5432/real");
  });
});
