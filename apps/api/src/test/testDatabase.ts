/**
 * Where the API test suite is allowed to point, and how it is allowed to wipe.
 *
 * ## Why this exists
 *
 * `installer.test.ts` truncates every table in the public schema on each test — it
 * has to, because it asserts the install wizard's behaviour from an empty database.
 * It read `DATABASE_URL` straight from the root `.env`, which is the **development**
 * database, so `pnpm test` and `pnpm backbone:check` destroyed whatever the developer
 * had. On 2026-08-09 that ate a user account somebody had just registered, and the
 * only reason the admin survived is that the wizard test recreates it. `TRUNCATE`
 * leaves nothing to restore from.
 *
 * Two defences, because either alone is insufficient:
 *
 *  1. **Point somewhere disposable.** The suite runs against `<devdb>_test`, created
 *     on demand, so the default path never touches development data at all.
 *  2. **Refuse to wipe anything else.** Even pointed at the wrong database by a stray
 *     `DATABASE_URL`, the destructive helper throws rather than truncating. A
 *     misconfiguration should fail loudly, not quietly delete.
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";

/** Suffix that marks a database as disposable. */
export const TEST_DB_SUFFIX = "_test";

/** Escape hatch for someone who really does mean this database. */
export const OVERRIDE_ENV = "ALLOW_DESTRUCTIVE_TESTS";

/** Reads the repo-root `.env` the same way `config/env.ts` does. */
export function loadRootEnv(): void {
  loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
}

/** The database name in a Postgres connection string, or null if unparseable. */
export function databaseNameOf(url: string): string | null {
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name || null;
  } catch {
    return null;
  }
}

/** The same connection string pointed at a different database. */
export function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * The URL the suite should use.
 *
 * `TEST_DATABASE_URL` wins if set — CI may hand us a throwaway database with any
 * name. Otherwise the dev URL with `_test` appended to the database name, which keeps
 * host, port and credentials identical so nothing else has to be configured.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL is not set, so the API test database cannot be derived.\n" +
      "Set DATABASE_URL (normally from the repo-root .env) or TEST_DATABASE_URL.",
    );
  }

  const name = databaseNameOf(base);
  if (!name) throw new Error(`DATABASE_URL has no database name: ${base}`);
  // Idempotent: re-deriving from an already-test URL must not give `x_test_test`.
  return name.endsWith(TEST_DB_SUFFIX) ? base : withDatabase(base, `${name}${TEST_DB_SUFFIX}`);
}

/**
 * Throw unless this database is safe to destroy.
 *
 * Called by every destructive test helper, so the check cannot be forgotten at a
 * call site — the only way to truncate is through a function that has already asked.
 */
export function assertDisposableDatabase(url = process.env.DATABASE_URL): void {
  if (process.env[OVERRIDE_ENV] === "1") return;

  const name = url ? databaseNameOf(url) : null;
  if (name && name.endsWith(TEST_DB_SUFFIX)) return;

  throw new Error(
    `Refusing to wipe database "${name ?? "<unknown>"}" — it is not a test database.\n\n` +
    `The API suite truncates every table, so it only runs against a database whose\n` +
    `name ends in "${TEST_DB_SUFFIX}". This normally happens automatically:\n` +
    `\`pnpm --filter @nodevo/api test\` derives <yourdb>${TEST_DB_SUFFIX}, creates it if\n` +
    `missing, and migrates it.\n\n` +
    `If you are running vitest in a way that bypasses that setup, either set\n` +
    `TEST_DATABASE_URL to a throwaway database, or — if you genuinely mean to destroy\n` +
    `this one — set ${OVERRIDE_ENV}=1.`,
  );
}
