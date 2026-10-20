import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../../../infrastructure/db.js";
import { env } from "../../../config/env.js";

const exec = promisify(execFile);

/**
 * Idempotent: prisma migrate deploy applies only pending migrations.
 *
 * The child takes Prisma's own advisory lock on its own connection, and a crashed
 * child's lock goes with its connection, so there is nothing to release first. It
 * used to disconnect the app's shared client here, which failed every other query
 * in flight, and run pg_advisory_unlock_all() on whichever pooled connection came
 * up, which can only ever release that connection's own locks.
 */
export async function runMigrations(): Promise<void> {
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
    const e = err as Error & { stdout?: string; stderr?: string };
    // A failed deploy is the one an admin most needs to read afterwards, so it
    // is recorded too. It may not land: the table itself can be what failed.
    await record(started, "failed", `${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`).catch(() => null);
    const msg = e.stderr ?? e.message ?? "migrate deploy failed";
    throw new Error(String(msg).slice(0, 500));
  }

  await record(started, "completed", `${stdout}\n${stderr}`);
}

async function record(started: number, status: "completed" | "failed", output: string): Promise<void> {
  await prisma.migrationRun.create({
    data: {
      adapter:     "core",
      command:     "migrate deploy",
      status,
      durationMs:  Date.now() - started,
      // Both ends: the head says what ran, and a failure's error is at the tail.
      output:      output.length > 8000 ? `${output.slice(0, 2000)}\n…\n${output.slice(-6000)}` : output,
      startedAt:   new Date(started),
      completedAt: new Date(),
    },
  });
}
