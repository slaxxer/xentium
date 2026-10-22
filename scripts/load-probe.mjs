#!/usr/bin/env node
/**
 * Load probe: how do the hot endpoints hold up on a BIG site?
 *
 *   1. A scratch database (`<db>_load`), migrated, installed through the wizard.
 *   2. Filled with SQL: 50k members, 20k articles, 200k article comments, 100k follows,
 *      100k article likes, 50k wall posts, 100k notifications.
 *   3. This tree's API on top (port 4320), then each endpoint: one warm-up, five timed
 *      runs, the median — and how many FULL TABLE SCANS it caused on the big tables,
 *      the usual sign of a missing index.
 *
 * Usage:  node scripts/load-probe.mjs        (build the API first: pnpm turbo run build --filter=@xentium/api...)
 * Needs:  Postgres you may create databases on, Redis, psql.
 * ⚠ Only ever touches a database whose name ends in `_load`, and drops it at the end.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (...a) => console.log("[load]", ...a);
const fileEnv = (() => {
  const f = path.join(ROOT, ".env");
  if (!existsSync(f)) return {};
  return Object.fromEntries(readFileSync(f, "utf8").split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
})();
const pick = (k, d) => process.env[k] ?? fileEnv[k] ?? d;
const BASE = new URL(pick("DATABASE_URL"));
BASE.search = "";
const DB = `${BASE.pathname.slice(1)}_load`;
if (!DB.endsWith("_load")) throw new Error(`refusing ${DB}`);
const dbUrl = new URL(BASE); dbUrl.pathname = `/${DB}`;
const adminUrl = new URL(BASE); adminUrl.pathname = "/postgres";
const PORT = 4320;
const WORK = mkdtempSync(path.join(tmpdir(), "xt-load-"));

const psql = (url, sql) => execFileSync("psql", ["--quiet", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At", url, "-c", sql], { encoding: "utf8" });

// ── Seed ────────────────────────────────────────────────────────────────────
const SEED = `
INSERT INTO xcf_users (id, email, username, "passwordHash", "createdAt", "updatedAt", follower_count, article_count, last_seen_at)
SELECT gen_random_uuid()::text, 'load' || g || '@load.test', 'load' || g, 'x', now() - g * interval '1 minute', now(),
       (random() * 400)::int, (random() * 20)::int, now() - random() * interval '30 days'
FROM generate_series(1, 50000) g;

-- Member number n → id, for the random picks below.
CREATE TEMP TABLE lu AS SELECT substr(username, 5)::int AS n, id FROM xcf_users WHERE username ~ '^load[0-9]+$';
CREATE UNIQUE INDEX ON lu (n);

INSERT INTO xcf_user_groups ("userId", "groupId")
SELECT id, (SELECT id FROM xcf_groups WHERE key = 'member') FROM lu;

INSERT INTO xcf_article_categories (id, name, slug, updated_at)
SELECT 'lc' || g, 'Category ' || g, 'load-cat-' || g, now() FROM generate_series(1, 10) g;

INSERT INTO xcf_articles (id, author_id, category_id, title, slug, body, body_plain, status, visibility, published_at, updated_at, like_count, comment_count, view_count)
SELECT 'la' || r.g, lu.id, 'lc' || (1 + (random() * 9)::int),
       'Load article ' || r.g, 'load-article-' || r.g, '{"type":"doc","content":[]}'::jsonb,
       'load article body text number ' || r.g || ' about community software and forums',
       'published', 'public', now() - r.g * interval '1 minute', now(),
       (random() * 50)::int, (random() * 30)::int, (random() * 1000)::int
FROM (SELECT g, 1 + (random() * 49999)::int AS n FROM generate_series(1, 20000) g) r JOIN lu ON lu.n = r.n;

INSERT INTO xcf_article_comments (id, article_id, author_id, body, updated_at, created_at)
SELECT 'lm' || r.g, 'la' || (1 + (random() * 19999)::int), lu.id, '<p>Load comment ' || r.g || '</p>', now(), now() - r.g * interval '1 second'
FROM (SELECT g, 1 + (random() * 49999)::int AS n FROM generate_series(1, 200000) g) r JOIN lu ON lu.n = r.n;

INSERT INTO xcf_user_follows (id, follower_id, following_id)
SELECT 'lf' || row_number() OVER (), a.id, b.id FROM (
  SELECT DISTINCT 1 + (random() * 49999)::int AS f, 1 + (random() * 49999)::int AS t FROM generate_series(1, 100000)
) x JOIN lu a ON a.n = x.f JOIN lu b ON b.n = x.t WHERE x.f <> x.t;

INSERT INTO xcf_article_likes (id, article_id, user_id)
SELECT 'll' || row_number() OVER (), 'la' || x.a, lu.id FROM (
  SELECT DISTINCT 1 + (random() * 19999)::int AS a, 1 + (random() * 49999)::int AS u FROM generate_series(1, 100000)
) x JOIN lu ON lu.n = x.u;

INSERT INTO xcf_profile_comments (id, profile_user_id, author_id, body, created_at)
SELECT 'lp' || r.g, w.id, a.id, 'Wall post ' || r.g, now() - r.g * interval '1 second'
FROM (SELECT g, CASE WHEN g <= 2000 THEN 1 ELSE 1 + (random() * 49999)::int END AS wall, 2 + (random() * 49998)::int AS author
      FROM generate_series(1, 50000) g) r
JOIN lu w ON w.n = r.wall JOIN lu a ON a.n = r.author WHERE r.wall <> r.author;

INSERT INTO xcf_notifications (id, user_id, type, title, body, created_at)
SELECT 'ln' || r.g, COALESCE(lu.id, (SELECT id FROM xcf_users WHERE email = 'admin@load.test')),
       'test', 'Load notification', 'Body ' || r.g, now() - r.g * interval '1 second'
FROM (SELECT g, CASE WHEN g <= 5000 THEN 0 ELSE 1 + (random() * 49999)::int END AS n FROM generate_series(1, 100000) g) r
LEFT JOIN lu ON lu.n = r.n;

ANALYZE;
`;

const BIG = ["xcf_users", "xcf_articles", "xcf_article_comments", "xcf_user_follows", "xcf_article_likes", "xcf_profile_comments", "xcf_notifications", "xcf_user_groups"];
const seqScans = () => Object.fromEntries(psql(dbUrl.toString(),
  `SELECT relname, seq_scan FROM pg_stat_user_tables WHERE relname IN (${BIG.map((t) => `'${t}'`).join(",")})`)
  .trim().split("\n").map((l) => { const [t, n] = l.split("|"); return [t, Number(n)]; }));

// ── Run ─────────────────────────────────────────────────────────────────────
let api = null;
async function call(p, token, body) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const init = body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers };
  // A keep-alive socket the server closed while we were busy (the seed) fails once.
  await fetch(`http://localhost:${PORT}/api/health`).catch(() => null);
  const t0 = performance.now();
  const res = await fetch(`http://localhost:${PORT}${p}`, init);
  const text = await res.text();
  return { status: res.status, ms: performance.now() - t0, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text };
}

try {
  psql(adminUrl.toString(), `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  psql(adminUrl.toString(), `CREATE DATABASE "${DB}"`);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl.toString() }, stdio: "ignore" });

  api = spawn("node", ["dist/server.js"], {
    cwd: path.join(ROOT, "apps/api"), stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(PORT), APP_URL: `http://localhost:${PORT}`,
      DATABASE_URL: dbUrl.toString(), REDIS_URL: pick("REDIS_URL", "redis://localhost:6379"), REDIS_KEY_PREFIX: "xt-load:",
      COOKIE_SECRET: "load-probe-cookie-secret-0123456789", JWT_SECRET: "load-probe-jwt-secret-0123456789abcdef0123456789",
      DUMMY_ARGON2_HASH: pick("DUMMY_ARGON2_HASH"), UPLOAD_DIR: path.join(WORK, "uploads"), DATA_DIR: path.join(WORK, "data"),
      BOOTSTRAP_OFFICIAL_PLUGINS: "false",
    },
  });
  let apiOut = "";
  api.stdout.on("data", (d) => { apiOut = (apiOut + d).slice(-20000); });
  api.stderr.on("data", (d) => { apiOut = (apiOut + d).slice(-20000); });
  process.on("exit", () => { if (process.exitCode) console.error(apiOut.slice(-4000)); });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch { /* starting */ }
    if (i > 120) throw new Error("API did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  const admin = { email: "admin@load.test", username: "loadadmin", password: "correct horse battery staple" };
  for (const [p, b] of [["database", {}], ["site", { siteName: "Load", siteUrl: "https://load.test", locale: "en" }], ["addons", { pluginIds: [] }], ["admin", admin], ["finalize", {}]]) {
    const r = await call(`/api/install/${p}`, null, b);
    if (r.status !== 200) throw new Error(`install ${p}: ${r.status} ${r.text}`);
  }
  log("seeding (a minute or two)…");
  api.on("exit", (code, sig) => log(`API exited: code ${code}, signal ${sig}`));
  try { psql(dbUrl.toString(), SEED); } catch (e) { log("seed failed:", String(e.stderr ?? e.message).slice(0, 2000)); throw e; }
  log("seeded; API still running:", api.exitCode === null);
  const idOf = (u) => psql(dbUrl.toString(), `SELECT id FROM xcf_users WHERE username = '${u}'`).trim();
  const ids = { lu1: idOf("load1"), lu7: idOf("load7") };
  const token = (await call("/api/auth/login", null, { email: admin.email, password: admin.password })).json.accessToken;

  const ENDPOINTS = [
    ["articles: latest", "/api/articles?limit=20"],
    ["articles: top", "/api/articles?limit=20&sort=popular"],
    ["articles: discussed, this month", "/api/articles?limit=20&sort=discussed&period=month"],
    ["articles: one category", "/api/articles?limit=20&categoryId=lc3"],
    ["articles: by an author", `/api/articles?limit=20&authorId=${ids.lu7}`],
    ["articles: page 500", "/api/articles?limit=20&page=500"],
    ["articles: trending", "/api/articles/trending"],
    ["articles: featured", "/api/articles/featured"],
    ["articles: popular tags", "/api/articles/tags/popular"],
    ["article: one", "/api/articles/load-article-12345"],
    ["article: comments", "/api/articles/la12345/comments"],
    ["search", "/api/search?q=community"],
    ["members: active", "/api/members?sort=active"],
    ["members: followers", "/api/members?sort=followers"],
    ["members: search", "/api/members?q=load123"],
    ["profile", "/api/users/load1"],
    ["profile: wall (2000 posts)", `/api/users/${ids.lu1}/profile-comments?limit=20`],
    ["profile: followers", `/api/users/${ids.lu1}/followers?page=1&limit=20`],
    ["home: stats", "/api/home/stats"],
    ["site: footer", "/api/site/footer"],
    ["members: groups", "/api/members/groups"],
    ["signed in: articles feed", "/api/articles?limit=20", true],
    ["signed in: following feed", "/api/articles?feed=following&limit=20", true],
    ["signed in: notifications (5000)", "/api/notifications", true],
    ["signed in: unread count", "/api/notifications/unread-count", true],
    ["ACP: users", "/api/admin/users?page=1&limit=25", true],
    ["ACP: dashboard overview", "/api/admin/dashboard/overview", true],
  ];
  const rows = [];
  for (const [name, p, auth] of ENDPOINTS) {
    await call(p, auth ? token : null);
    await new Promise((r) => setTimeout(r, 1200));
    const before = seqScans();
    const times = [];
    let status = 0;
    for (let i = 0; i < 5; i++) { const r = await call(p, auth ? token : null); times.push(r.ms); status = r.status; }
    await new Promise((r) => setTimeout(r, 1200));
    const after = seqScans();
    const scans = BIG.map((t) => [t, (after[t] ?? 0) - (before[t] ?? 0)]).filter(([, n]) => n > 0).map(([t, n]) => `${t.replace("xcf_", "")}×${n / 5}`);
    times.sort((a, b) => a - b);
    rows.push({ name, status, median: Math.round(times[2]), max: Math.round(times[4]), scans: scans.join(" ") });
  }
  console.log("\n" + ["endpoint".padEnd(34), "status", "median", "max  ", "full scans per request"].join("  "));
  for (const r of rows) console.log([r.name.padEnd(34), String(r.status).padEnd(6), `${r.median}ms`.padStart(6), `${r.max}ms`.padStart(5), r.scans].join("  "));
} finally {
  api?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  try { psql(adminUrl.toString(), `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`); } catch { /* best effort */ }
  rmSync(WORK, { recursive: true, force: true });
}
