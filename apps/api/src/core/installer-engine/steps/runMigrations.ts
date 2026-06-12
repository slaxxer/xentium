import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../../../infrastructure/db.js";
import { env } from "../../../config/env.js";

const exec = promisify(execFile);

/**
 * Idempotent: prisma migrate deploy applies only pending migrations.
 *
 * We disconnect the Prisma client before spawning the child process so the
 * API's connection pool does not interfere with the advisory lock that
 * `migrate deploy` needs to acquire. The pool reconnects automatically on
 * the next query.
 */
export async function runMigrations(): Promise<void> {
  // Release any stale advisory lock from a previous failed run, then free
  // the API's pooled connections so the child process can acquire the lock.
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock_all()`;
  } catch { /* table may not exist yet on first-ever run */ }

  await prisma.$disconnect();

  const started = Date.now();
  let stdout = "";
  let stderr = "";

  try {
    ({ stdout, stderr } = await exec(
      "npx",
      ["prisma", "migrate", "deploy"],
      { cwd: env.REPO_ROOT, env: process.env, timeout: 120_000 },
    ));
  } catch (err: unknown) {
    // Re-connect before re-throwing so the rest of the API keeps working.
    await prisma.$connect().catch(() => null);
    const e = err as Error & { stderr?: string };
    const msg = e.stderr ?? e.message ?? "migrate deploy failed";
    throw new Error(String(msg).slice(0, 500));
  }

  // Pool reconnects automatically on first use — no explicit $connect needed.
  await prisma.migrationRun.create({
    data: {
      adapter:     "core",
      command:     "migrate deploy",
      durationMs:  Date.now() - started,
      output:      `${stdout}\n${stderr}`.slice(0, 8000),
      startedAt:   new Date(started),
      completedAt: new Date(),
    },
  });
}
