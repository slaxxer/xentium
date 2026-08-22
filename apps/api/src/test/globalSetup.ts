/**
 * Creates and migrates the API suite's throwaway database, once per run.
 *
 * Runs in vitest's main process before any test file is loaded. Two steps, both
 * idempotent so a second run is a no-op:
 *
 *  1. `CREATE DATABASE <devdb>_test` if it does not exist. Connected to the
 *     maintenance database on the same server, so host, port and credentials are
 *     whatever the developer already has working — nothing new to configure.
 *  2. `prisma migrate deploy` against it. `deploy` and not `dev`: it applies the
 *     committed migrations and nothing else, so it never proposes the destructive
 *     reset that `migrate dev` reaches for when plugin tables make the schema drift.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import {
  databaseNameOf,
  loadRootEnv,
  resolveTestDatabaseUrl,
  withDatabase,
} from "./testDatabase.js";

const run = promisify(execFile);

/** Repo root, where prisma.config.ts and the migrations live. */
const REPO_ROOT = path.resolve(process.cwd(), "../..");

async function ensureDatabase(url: string): Promise<boolean> {
  const name = databaseNameOf(url);
  if (!name) throw new Error(`Cannot derive a database name from ${url}`);

  // `postgres` is the conventional maintenance database; CREATE DATABASE cannot run
  // from inside the database being created.
  const admin = new Client({ connectionString: withDatabase(url, "postgres") });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount) return false;
    // The name is derived from DATABASE_URL, not from user input, and identifiers
    // cannot be parameterised — quoted to keep it a single identifier regardless.
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    return true;
  } finally {
    await admin.end();
  }
}

export default async function setup(): Promise<void> {
  loadRootEnv();

  let url: string;
  try {
    url = resolveTestDatabaseUrl();
  } catch (err) {
    // Without a database the API suite cannot run at all; say why rather than
    // letting every test fail on a connection error.
    throw new Error(`API test setup: ${(err as Error).message}`);
  }

  const created = await ensureDatabase(url);
  if (created) console.log(`[api tests] created ${databaseNameOf(url)}`);

  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
  });
}
