#!/usr/bin/env node
/**
 * pnpm e2e: reset the e2e database, then run Playwright against a stack of its own.
 *
 *   node scripts/e2e.mjs              reset + run
 *   node scripts/e2e.mjs --ui         reset + Playwright UI
 *   node scripts/e2e.mjs --reset-only reset, nothing else
 *
 * The database comes from e2e/e2eEnv.mjs, which refuses anything not named *_e2e or
 * *_test, so this can never reset the dev database or a production one.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, E2E_UPLOAD_DIR, e2eEnv } from "../e2e/e2eEnv.mjs";

const mode = process.argv[2] ?? "";
if (!["", "--ui", "--reset-only"].includes(mode)) {
  console.error(`Unknown option "${mode}". Use --ui or --reset-only.`);
  process.exit(2);
}

let vars;
try {
  vars = e2eEnv();
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}
const env = { ...process.env, ...vars };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const db = new URL(vars.DATABASE_URL).pathname.slice(1);
console.log(`[e2e] resetting database "${db}"`);
run("pnpm", ["exec", "prisma", "migrate", "reset", "--force"]);
// Installed plugins and uploads from the last run would no longer match the fresh database.
rmSync(resolve(REPO_ROOT, "apps/api", E2E_UPLOAD_DIR), { recursive: true, force: true });

if (mode === "--reset-only") process.exit(0);
run("pnpm", ["--filter", "@xentium/e2e", "run", mode === "--ui" ? "e2e:ui" : "e2e"]);
