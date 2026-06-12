import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

/**
 * Non-fatal env completeness probe used by the server/worker boot gates.
 *
 * MUST NOT import ./env.js — that module parses the full schema and calls
 * process.exit(1) when required keys are missing, which is exactly the case
 * this probe exists to detect. It also must stay free of any infrastructure
 * imports (prisma/redis instantiate at module load).
 */

// Same resolution as env.ts: .env lives at the repo root, two levels above
// the API process cwd (apps/api in dev).
export const ENV_FILE_PATH = path.resolve(process.cwd(), "../../.env");

// The keys env.ts hard-requires, with the same minimum lengths as its schema.
const REQUIRED: Array<{ key: string; min: number }> = [
  { key: "DATABASE_URL", min: 1 },
  { key: "COOKIE_SECRET", min: 16 },
  { key: "JWT_SECRET", min: 32 },
  { key: "DUMMY_ARGON2_HASH", min: 1 },
];

/** Parse the repo-root .env file. Missing/unreadable file → empty object. */
export function parseEnvFile(): Record<string, string> {
  try {
    return parse(readFileSync(ENV_FILE_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Which required keys are absent (or too short) in both process.env and the
 * .env file. Empty array = env is complete and the full app can boot.
 * Re-reads the file on every call so a poller sees the wizard's write.
 */
export function missingRequiredEnv(): string[] {
  const file = parseEnvFile();
  return REQUIRED
    .filter(({ key, min }) => {
      const value = process.env[key] ?? file[key];
      return !value || value.length < min;
    })
    .map(({ key }) => key);
}

/**
 * Assign every .env value into process.env without overriding existing vars
 * (same precedence as dotenv's config()). Used by the worker after its wait
 * loop — the worker never re-imports dotenv between polls.
 */
export function loadEnvFileIntoProcess(): void {
  for (const [key, value] of Object.entries(parseEnvFile())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
