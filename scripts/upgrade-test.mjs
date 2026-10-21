#!/usr/bin/env node
/**
 * Upgrade test: does a site made with the PREVIOUS release survive an update to this
 * code, and is its backup a working copy?
 *
 *   1. Check out the previous release (a git tag) beside this tree, build its API.
 *   2. Install a site with it on a scratch database: the wizard over HTTP, then real
 *      data — a published article and an uploaded avatar.
 *   3. Back it up with pg_dump, the way the CLI does before an update.
 *   4. Migrate the same database with THIS code, start it, and check the data.
 *   5. Restore the backup into a second scratch database, migrate, start, check again.
 *
 * Usage:  node scripts/upgrade-test.mjs [fromRef]     (default: the newest v* tag before HEAD)
 * Needs:  Postgres you may create databases on (DATABASE_URL in .env or the env),
 *         Redis, pg_dump + psql, pnpm. Uses ports 4310/4311.
 *
 * ⚠ Only ever touches databases whose names end in `_upgrade_a` / `_upgrade_b`, and
 *   drops them before and after. Anything else is refused.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (...a) => console.log("[upgrade]", ...a);
const fail = (msg) => { console.error(`[upgrade] FAIL: ${msg}`); process.exitCode = 1; throw new Error(msg); };

// ── Configuration ───────────────────────────────────────────────────────────
function envFromFile() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = envFromFile();
const pick = (k, d) => process.env[k] ?? fileEnv[k] ?? d;
const BASE_URL = pick("DATABASE_URL");
if (!BASE_URL) fail("DATABASE_URL is not set");
const REDIS_URL = pick("REDIS_URL", "redis://localhost:6379");
const DUMMY = pick("DUMMY_ARGON2_HASH");
if (!DUMMY) fail("DUMMY_ARGON2_HASH is not set");

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
// The newest release BEFORE this commit: on a tagged release commit itself, plain
// `describe` would answer with that same tag and the test would update to itself.
const from = process.argv[2] ?? sh("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^"], { cwd: ROOT }).trim();
const WORK = path.join(process.env.UPGRADE_WORK ?? tmpdir(), `xt-upgrade-${Date.now()}`);
mkdirSync(WORK, { recursive: true });
const UPLOADS = path.join(WORK, "uploads");
const DUMP = path.join(WORK, "backup.sql");

function dbUrl(suffix) {
  const u = new URL(BASE_URL);
  const name = `${u.pathname.slice(1) || "xentium"}_upgrade_${suffix}`;
  if (!/_upgrade_[ab]$/.test(name)) fail(`refusing database ${name}`);
  u.pathname = `/${name}`;
  u.search = "";
  return { url: u.toString(), name };
}
const A = dbUrl("a");
const B = dbUrl("b");
function adminUrl() { const u = new URL(BASE_URL); u.pathname = "/postgres"; u.search = ""; return u.toString(); }
function recreate(db) {
  sh("psql", ["--quiet", "--no-psqlrc", adminUrl(), "-c", `DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`]);
  sh("psql", ["--quiet", "--no-psqlrc", adminUrl(), "-c", `CREATE DATABASE "${db.name}"`]);
}
function drop(db) {
  try { sh("psql", ["--quiet", "--no-psqlrc", adminUrl(), "-c", `DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`]); } catch { /* best effort */ }
}

// ── Building and running a tree ─────────────────────────────────────────────
function build(tree, label) {
  log(`${label}: installing and building (${tree})`);
  sh("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: tree, stdio: ["ignore", "ignore", "inherit"] });
  sh("pnpm", ["exec", "prisma", "generate"], { cwd: tree, stdio: ["ignore", "ignore", "inherit"] });
  sh("pnpm", ["exec", "turbo", "run", "build", "--filter=@xentium/api..."], { cwd: tree, stdio: ["ignore", "ignore", "inherit"] });
}
function migrate(tree, db, label) {
  log(`${label}: prisma migrate deploy on ${db.name}`);
  sh("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: tree, env: { ...process.env, DATABASE_URL: db.url }, stdio: ["ignore", "ignore", "inherit"] });
}

let running = null;
async function start(tree, db, port, label) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    APP_URL: `http://localhost:${port}`,
    DATABASE_URL: db.url,
    REDIS_URL,
    REDIS_KEY_PREFIX: `xt-upgrade-${port}:`,
    COOKIE_SECRET: "upgrade-test-cookie-secret-0123456789",
    JWT_SECRET: "upgrade-test-jwt-secret-0123456789abcdef0123456789",
    DUMMY_ARGON2_HASH: DUMMY,
    UPLOAD_DIR: UPLOADS,
    DATA_DIR: path.join(WORK, "data"),
    BOOTSTRAP_OFFICIAL_PLUGINS: "false",
  };
  const api = path.join(tree, "apps/api");
  running = spawn("node", ["dist/server.js"], { cwd: api, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  running.stdout.on("data", (d) => { out += d; });
  running.stderr.on("data", (d) => { out += d; });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (running.exitCode !== null) fail(`${label}: API exited\n${out.slice(-3000)}`);
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) { log(`${label}: API up on ${port}`); return; } } catch { /* not yet */ }
  }
  fail(`${label}: API did not come up\n${out.slice(-3000)}`);
}
async function stop() {
  if (!running) return;
  running.kill("SIGTERM");
  await new Promise((r) => { running.once("exit", r); setTimeout(r, 10_000); });
  running = null;
}

async function call(port, method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`http://localhost:${port}${p}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const expectOk = (r, what) => { if (r.status < 200 || r.status >= 300) fail(`${what}: ${r.status} ${r.text.slice(0, 500)}`); return r; };

// ── The data a site carries across ──────────────────────────────────────────
const ADMIN = { email: "admin@upgrade.test", username: "upgrader", password: "correct horse battery staple" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000010000000100806000000" +
  "1ff3ff610000001949444154789c63fcffff3f0325800962c0a8018c1a30600000c4c10ffd5a1f2e5b0000000049454e44ae426082", "hex");

async function seed(port) {
  expectOk(await call(port, "POST", "/api/install/database", { body: {} }), "install: database");
  expectOk(await call(port, "POST", "/api/install/site", { body: { siteName: "Upgrade Test", siteUrl: "https://upgrade.test", locale: "en" } }), "install: site");
  expectOk(await call(port, "POST", "/api/install/addons", { body: { pluginIds: [] } }), "install: addons");
  expectOk(await call(port, "POST", "/api/install/admin", { body: ADMIN }), "install: admin");
  expectOk(await call(port, "POST", "/api/install/finalize", { body: {} }), "install: finalize");
  const token = expectOk(await call(port, "POST", "/api/auth/login", { body: { email: ADMIN.email, password: ADMIN.password } }), "login").json.accessToken;
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Written before the update." }] }] };
  const art = expectOk(await call(port, "POST", "/api/articles", { token, body: { title: "Before the update", body: doc } }), "create article").json;
  expectOk(await call(port, "POST", `/api/articles/${art.id}/publish`, { token, body: {} }), "publish article");
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "avatar.png");
  const avatar = expectOk(await call(port, "POST", "/api/account/avatar", { token, form }), "upload avatar").json.url;
  return { slug: art.slug, avatar };
}

async function verify(port, data, label) {
  const health = expectOk(await call(port, "GET", "/api/health"), `${label}: health`);
  const status = expectOk(await call(port, "GET", "/api/install/status"), `${label}: install status`).json;
  if (!status.installed) fail(`${label}: the site reads as not installed`);
  const login = expectOk(await call(port, "POST", "/api/auth/login", { body: { email: ADMIN.email, password: ADMIN.password } }), `${label}: admin signs in`);
  const token = login.json.accessToken;
  const art = expectOk(await call(port, "GET", `/api/articles/${data.slug}`), `${label}: article readable`).json;
  if (art.title !== "Before the update") fail(`${label}: article title is ${art.title}`);
  const me = expectOk(await call(port, "GET", "/api/auth/me", { token }), `${label}: /auth/me`).json;
  const avatarPath = new URL(data.avatar, `http://localhost:${port}`).pathname;
  const img = await fetch(`http://localhost:${port}${avatarPath}`);
  if (!img.ok) fail(`${label}: the avatar uploaded before the update is gone (${img.status} ${avatarPath})`);
  log(`${label}: OK — health ${health.status}, installed, admin ${me.user?.username ?? me.username ?? "?"} signed in, article and avatar intact`);
}

// ── Run ─────────────────────────────────────────────────────────────────────
const FROM_TREE = path.join(WORK, "from");
let ok = false;
try {
  log(`from ${from} to the working tree; scratch: ${A.name}, ${B.name}; work dir ${WORK}`);
  recreate(A); drop(B);

  sh("git", ["worktree", "add", "--detach", FROM_TREE, from], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  build(FROM_TREE, from);
  migrate(FROM_TREE, A, from);
  await start(FROM_TREE, A, 4310, from);
  const data = await seed(4310);
  await verify(4310, data, `${from} (before)`);
  await stop();

  log(`backup: pg_dump ${A.name}`);
  sh("pg_dump", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--file", DUMP, A.url]);

  build(ROOT, "current");
  migrate(ROOT, A, "current");
  await start(ROOT, A, 4311, "current");
  await verify(4311, data, "current (updated in place)");
  await stop();

  log(`restore: the backup into ${B.name}`);
  recreate(B);
  sh("psql", ["--quiet", "--no-psqlrc", "--single-transaction", "--set", "ON_ERROR_STOP=1", "--file", DUMP, B.url], { stdio: ["ignore", "ignore", "inherit"] });
  migrate(ROOT, B, "current");
  await start(ROOT, B, 4311, "current");
  await verify(4311, data, "current (restored from the backup)");
  await stop();
  ok = true;
  log("PASS");
} catch (e) {
  if (!process.exitCode) { console.error(e); process.exitCode = 1; }
} finally {
  await stop();
  drop(A); drop(B);
  try { sh("git", ["worktree", "remove", "--force", FROM_TREE], { cwd: ROOT }); } catch { /* not created */ }
  if (ok) rmSync(WORK, { recursive: true, force: true });
  else log(`left ${WORK} for a look`);
}
