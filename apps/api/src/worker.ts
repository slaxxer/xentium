import { missingRequiredEnv, loadEnvFileIntoProcess } from './config/envProbe.js';

/**
 * Worker boot gate — mirrors server.ts. The worker has no setup UI of its
 * own: while the install wizard hasn't written .env yet it just waits,
 * polling the env probe, so `pnpm dev:apps` doesn't crash-loop on a fresh
 * clone. Once env is complete the actual worker (workerBoot.js) is imported
 * and evaluates with full env — same hot-swap idea, no restart needed.
 *
 * It then waits for the schema as well. The install wizard is what runs the
 * migrations, so on a fresh install there is a stretch where the config is
 * complete and the tables do not exist yet — and a worker booting into that
 * fills the admin's first screen with "table does not exist".
 */
const POLL_MS = 2000;

/** Is the core schema there? Asked with a throwaway connection, not the pool. */
async function schemaExists(): Promise<boolean> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ table: string | null }>(
      "SELECT to_regclass('public.xcf_settings')::text AS table",
    );
    return !!rows[0]?.table;
  } catch {
    // The database itself isn't reachable yet — same thing as far as we care.
    return false;
  } finally {
    await client.end().catch(() => null);
  }
}

async function main() {
  if (missingRequiredEnv().length > 0) {
    console.log('[worker] waiting for installer setup to write .env…');
    while (missingRequiredEnv().length > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    console.log('[worker] setup complete — booting');
  }

  // ⚠ UNCONDITIONALLY, and before the schema probe.
  //
  // `missingRequiredEnv()` reads the FILE, so a complete .env skipped the branch
  // above — and with it the only call that put those values into process.env.
  // Everything after this point that reads `process.env` directly then saw
  // nothing. `env.ts` hides it, because dotenv loads the file when that module
  // evaluates; the probe below runs BEFORE any of that and used the raw
  // variable, so it connected to libpq's defaults, never found `xcf_settings`,
  // and waited for an installer that had finished months ago.
  //
  // That is not theoretical: it stranded the worker on every install whose env
  // comes only from XENTIUM_ENV_FILE — i.e. every npm install, where systemd
  // passes the path and nothing else. No scheduled job ran on those sites at
  // all. Loading here is idempotent (dotenv never overrides an existing var),
  // so the setup-mode path above is unaffected.
  loadEnvFileIntoProcess();

  if (!(await schemaExists())) {
    console.log('[worker] waiting for the install wizard to create the database schema…');
    while (!(await schemaExists())) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    console.log('[worker] schema is there — booting');
  }

  await import('./workerBoot.js');
}

main().catch((err) => {
  console.error('[worker] startup failed:', err);
  process.exit(1);
});
