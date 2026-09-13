import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import argon2 from "argon2";

/**
 * Writes the wizard-collected configuration to the repo-root .env and into
 * process.env (spec §16 step 4 — ".env written by the installer").
 *
 * Deliberately infra-free: only node builtins + argon2, so the setup server
 * can import it while env is still incomplete (no env.ts/prisma/redis in the
 * module graph).
 */

// Same resolution as env.ts / envProbe.ts: repo root is two levels above the
// API process cwd (apps/api in dev).
const ENV_PATH = path.resolve(process.cwd(), "../../.env");

export interface EnvWriteInput {
  databaseUrl: string;
  redisUrl?: string;
}

/** Minimum lengths matching the env.ts schema — shorter values are replaced. */
const SECRET_MIN = {
  COOKIE_SECRET: 16,
  JWT_SECRET: 32,
  REFRESH_TOKEN_HMAC_SECRET: 32,
  DUMMY_ARGON2_HASH: 1,
} as const;

function parseLine(line: string): { key: string; value: string } | null {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  return m ? { key: m[1]!, value: m[2]!.trim() } : null;
}

/**
 * Merge-write: replaces the value on existing `KEY=` lines and appends keys
 * that are not present yet. Unknown lines and comments are preserved verbatim
 * — a hand-edited .env is never clobbered.
 */
function mergeEnvContent(existing: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = existing.length ? existing.split(/\r?\n/) : [];

  const merged = lines.map((line) => {
    const parsed = parseLine(line);
    if (!parsed || !pending.has(parsed.key)) return line;
    const value = pending.get(parsed.key)!;
    pending.delete(parsed.key);
    return `${parsed.key}=${value}`;
  });

  if (pending.size > 0) {
    if (merged.length && merged[merged.length - 1]!.trim() !== "") merged.push("");
    merged.push("# ── Written by the Xentium install wizard ──");
    for (const [key, value] of pending) merged.push(`${key}=${value}`);
  }

  return merged.join("\n").replace(/\n*$/, "\n");
}

/**
 * Builds the full update set (connection strings + any secrets that are
 * missing/too short), writes .env with mode 0600, and assigns every written
 * key into process.env so the in-process hot swap sees the values immediately
 * (dotenv never overrides existing process.env entries).
 */
export async function writeEnvConfig(input: EnvWriteInput): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    /* no .env yet — created below */
  }

  const fileValues: Record<string, string> = {};
  for (const line of existing.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) fileValues[parsed.key] = parsed.value;
  }

  const updates: Record<string, string> = { DATABASE_URL: input.databaseUrl };
  if (input.redisUrl) updates.REDIS_URL = input.redisUrl;

  // Generate secrets only where no valid value exists yet (file or process).
  const needsSecret = (key: keyof typeof SECRET_MIN): boolean => {
    const current = process.env[key] ?? fileValues[key];
    return !current || current.length < SECRET_MIN[key];
  };
  if (needsSecret("COOKIE_SECRET")) {
    updates.COOKIE_SECRET = crypto.randomBytes(32).toString("hex");
  }
  if (needsSecret("JWT_SECRET")) {
    updates.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  }
  if (needsSecret("REFRESH_TOKEN_HMAC_SECRET")) {
    updates.REFRESH_TOKEN_HMAC_SECRET = crypto.randomBytes(48).toString("hex");
  }
  if (needsSecret("DUMMY_ARGON2_HASH")) {
    // Constant-time login decoy (§43) — hash of a throwaway random value.
    updates.DUMMY_ARGON2_HASH = await argon2.hash(crypto.randomBytes(24).toString("hex"));
  }

  await fs.writeFile(ENV_PATH, mergeEnvContent(existing, updates), { mode: 0o600 });

  // In-memory swap: these keys were missing, so assignment (not dotenv) is
  // what makes the dynamic-import boot + spawned prisma CLI see them.
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}
