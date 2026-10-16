import fs from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

/**
 * Old links → new pages, after a migration.
 *
 * Every board has years of links pointing at it: search results, bookmarks, other
 * sites. After a switch they would all break. We write them a way home, for nginx and
 * as a CSV for anything else.
 *
 * Scale matters: a board with 100 000 threads can't become 100 000 regex rules. So the
 * nginx file is two lookups per kind of page: a handful of patterns per platform that
 * pull the OLD id out of the request ("viewtopic.php?t=123" → 123), then an exact
 * id → new address table (a hash lookup in nginx, fast at any size).
 */

export type RedirectEntity = "post" | "thread" | "forum_node" | "user" | "article";

/**
 * A pattern on the request URI (path + query, exactly as the browser sent it) with a
 * named group `id` holding the old id. Patterns allow any folder in front, since old
 * boards often lived in /forum/ or /community/.
 *
 * A pattern must never match one of OUR addresses (/forum/thread/<slug>, /forum/<slug>,
 * /u/<name>, /articles/<slug>): a thread slug can start with digits ("2024-plans"), and
 * a pattern that caught it would send a visitor to some other thread.
 */
export interface RedirectPattern {
  entity: RedirectEntity;
  /** PCRE as nginx reads it (case-insensitive), anchored with ^. Must contain (?<id>…). */
  regex: string;
}

/** Old addresses that carry no id (vBulletin 5 channels, WordPress permalinks): the exact path → old id.
 *  nginx tries exact keys before patterns, so these also win over a pattern that would match. */
export interface ExactRedirect {
  entity: RedirectEntity;
  path: string;
  sourceId: string;
}

export interface RedirectSpec {
  patterns: RedirectPattern[];
  exact?: ExactRedirect[];
}

/** Order matters: a link to a post often also names its thread, and the post is the better target. */
const ORDER: RedirectEntity[] = ["post", "thread", "forum_node", "article", "user"];

/** Our API, uploads and built files are never an old link ("/api/…/threads/2024-plans" looks like vBulletin 4). */
const guarded = (regex: string) => regex.replace(/^\^\//, "^/(?!api/|uploads/|assets/)");

const enc = (s: string) => encodeURIComponent(s);
/** nginx map values and keys are quoted; a quote or backslash would end them, and a `$` would read as a variable. */
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "%24")}"`;

/** Where each imported item lives now, keyed by entity and old id. */
async function newAddresses(pool: pg.Pool, platform: string): Promise<Map<RedirectEntity, Map<string, string>>> {
  const out = new Map<RedirectEntity, Map<string, string>>(ORDER.map((e) => [e, new Map()]));
  const rows = async (sql: string) => (await pool.query(sql, [platform]).catch(() => ({ rows: [] as never[] }))).rows as Array<{ source_id: string; target: string }>;

  for (const r of await rows(
    `SELECT m.source_id, '/forum/thread/' || t.slug AS target FROM xcf_import_map m JOIN forum_threads t ON t.id = m.xentium_id
      WHERE m.platform = $1 AND m.entity = 'thread'`)) out.get("thread")!.set(r.source_id, r.target);
  for (const r of await rows(
    `SELECT m.source_id, '/forum/' || n.slug AS target FROM xcf_import_map m JOIN forum_nodes n ON n.id = m.xentium_id
      WHERE m.platform = $1 AND m.entity = 'forum_node'`)) out.get("forum_node")!.set(r.source_id, r.target);
  for (const r of await rows(
    `SELECT m.source_id, '/articles/' || a.slug AS target FROM xcf_import_map m JOIN xcf_articles a ON a.id = m.xentium_id
      WHERE m.platform = $1 AND m.entity = 'article'`)) out.get("article")!.set(r.source_id, r.target);
  for (const r of await rows(
    `SELECT m.source_id, u.username AS target FROM xcf_import_map m JOIN xcf_users u ON u.id = m.xentium_id
      WHERE m.platform = $1 AND m.entity = 'user'`)) out.get("user")!.set(r.source_id, `/u/${enc(r.target)}`);

  // A post opens its thread on the page it is on, scrolled to it (#post-<id>). The
  // thread page lists deleted posts too (as a placeholder), so they count for the page.
  const per = await pool.query(`SELECT value FROM xcf_settings WHERE key = 'forum.posts_per_page'`).catch(() => ({ rows: [] as never[] }));
  const perPage = Math.max(1, Number(per.rows[0]?.value) || 20);
  for (const r of await rows(
    `SELECT m.source_id, '/forum/thread/' || t.slug
            || CASE WHEN p.pos > ${perPage} THEN '?page=' || (((p.pos - 1) / ${perPage}) + 1)::text ELSE '' END
            || '#post-' || p.id AS target
       FROM xcf_import_map m
       JOIN (SELECT id, thread_id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at, id) AS pos
               FROM forum_posts) p ON p.id = m.xentium_id
       JOIN forum_threads t ON t.id = p.thread_id
      WHERE m.platform = $1 AND m.entity = 'post'`)) out.get("post")!.set(r.source_id, r.target);
  return out;
}

/**
 * Our own addresses an old one could be mistaken for: every board ("/forum/general"
 * is also a vBulletin 5 channel address, and redirecting it to itself would loop), and
 * threads and articles whose slug starts with a digit ("/forum/thread/2024-plans" looks
 * like an old "<id>-<title>"). Every lookup lists them as exact keys with no target,
 * and nginx tries exact keys before patterns.
 */
async function ownPaths(pool: pg.Pool): Promise<Set<string>> {
  const q = async (sql: string) => ((await pool.query(sql).catch(() => ({ rows: [] as never[] }))).rows as Array<{ p: string }>).map((r) => r.p);
  const paths = [
    "/forum",
    ...(await q(`SELECT '/forum/' || slug AS p FROM forum_nodes`)),
    ...(await q(`SELECT '/forum/thread/' || slug AS p FROM forum_threads WHERE slug ~ '^[0-9]'`)),
    ...(await q(`SELECT '/articles/' || slug AS p FROM xcf_articles WHERE slug ~ '^[0-9]'`)),
  ];
  return new Set(paths.flatMap((p) => [p, `${p}/`]));
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(n));
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export interface RedirectFiles { nginx: string; csv: string; count: number }

/** Writes `<dir>/xentium-redirects-<platform>.nginx.conf` and `<dir>/xentium-redirects-<platform>.csv`. */
export async function writeRedirects(pool: pg.Pool, platform: string, spec: RedirectSpec, dir: string): Promise<RedirectFiles> {
  const targets = await newAddresses(pool, platform);
  const ours = await ownPaths(pool);
  // An old address that is also one of ours stays ours.
  spec = { ...spec, exact: (spec.exact ?? []).filter((x) => !ours.has(x.path)) };
  const v = (e: RedirectEntity) => `$xt_${platform.replace(/[^a-z0-9]/gi, "")}_${e}`;

  const http: string[] = [];
  const server: string[] = [];
  const csv: string[] = ["kind,old_id_or_path,new_address"];
  let count = 0;
  let longest = 0;

  for (const entity of ORDER) {
    const known = targets.get(entity)!;
    const patterns = spec.patterns.filter((p) => p.entity === entity);
    const exact = (spec.exact ?? []).filter((x) => x.entity === entity && known.has(x.sourceId));
    if (!known.size || (!patterns.length && !exact.length)) continue;

    http.push(`# ${entity}: pull the old id out of the request…`);
    http.push(`map $request_uri ${v(entity)}_old {`, `  default "";`);
    for (const p of patterns) {
      // Quoted, since a pattern may hold ";" or "{". Inside quotes nginx only reads
      // \" \' \\ \t \r \n as escapes, so those (and spaces) can't appear in a pattern.
      if (/\s|"|\\["'\\tnr]/.test(p.regex) || !p.regex.startsWith("^") || !p.regex.includes("(?<id>")) {
        throw new Error(`redirect pattern can't go in an nginx map: ${p.regex}`);
      }
      http.push(`  "~*${guarded(p.regex)}" $id;`);
    }
    // Exact keys: this kind's own id-less addresses, then any address known to be
    // something else (another kind's, or one of ours), so no pattern can claim it.
    const keys = new Set<string>();
    for (const x of exact) if (!keys.has(x.path)) { keys.add(x.path); http.push(`  ${q(x.path)} ${q(x.sourceId)};`); }
    for (const other of [...(spec.exact ?? []).filter((x) => x.entity !== entity).map((x) => x.path), ...ours]) {
      if (!keys.has(other)) { keys.add(other); http.push(`  ${q(other)} "";`); }
    }
    http.push("}");
    http.push(`# …and look up where it lives now.`);
    http.push(`map ${v(entity)}_old ${v(entity)}_new {`, `  default "";`);
    for (const [oldId, target] of known) {
      http.push(`  ${q(oldId)} ${q(target)};`);
      csv.push(`${entity},${csvCell(oldId)},${csvCell(target)}`);
      longest = Math.max(longest, oldId.length);
      count++;
    }
    http.push("}", "");
    server.push(`if (${v(entity)}_new) { return 301 ${v(entity)}_new; }`);
  }
  for (const x of spec.exact ?? []) {
    const target = targets.get(x.entity)?.get(x.sourceId);
    if (target) csv.push(`${x.entity},${csvCell(x.path)},${csvCell(target)}`);
    longest = Math.max(longest, x.path.length);
  }

  const nginx = [
    `# Xentium: redirects from your old ${platform} addresses, written by the migration tool.`,
    `# Regenerate after another migration run, or if you change the forum's posts per page.`,
    `#`,
    `# 1. Put the "map" blocks below in nginx's http { } block (e.g. include this file there).`,
    `# 2. Put these lines in your Xentium server { } block, before the location blocks:`,
    ...server.map((l) => `#      ${l}`),
    `#`,
    `# nginx sizes its lookup tables up front. If it refuses to start with "could not build`,
    `# map_hash", add these to the http { } block (once, not per file):`,
    `#      map_hash_max_size ${pow2(Math.max(2048, count * 2))};`,
    `#      map_hash_bucket_size ${pow2(Math.max(64, longest + 16))};`,
    ``,
    ...http,
  ].join("\n");

  await fs.mkdir(dir, { recursive: true });
  const nginxPath = path.join(dir, `xentium-redirects-${platform}.nginx.conf`);
  const csvPath = path.join(dir, `xentium-redirects-${platform}.csv`);
  await fs.writeFile(nginxPath, nginx + "\n");
  await fs.writeFile(csvPath, csv.join("\n") + "\n");
  return { nginx: nginxPath, csv: csvPath, count };
}

/**
 * Which old item an address names, the way the nginx file decides it: kinds in
 * order, exact paths before patterns, the first pattern that matches. For tests and
 * for checking a spec against real links before going live.
 */
export function resolveOldAddress(spec: RedirectSpec, requestUri: string): { entity: RedirectEntity; id: string } | null {
  for (const entity of ORDER) {
    const exact = (spec.exact ?? []).find((x) => x.entity === entity && x.path === requestUri);
    if (exact) return { entity, id: exact.sourceId };
    if ((spec.exact ?? []).some((x) => x.entity !== entity && x.path === requestUri)) continue;
    for (const p of spec.patterns.filter((x) => x.entity === entity)) {
      const id = new RegExp(guarded(p.regex), "i").exec(requestUri)?.groups?.id;
      if (id) return { entity, id };
    }
  }
  return null;
}

/** Addresses of ours that no adapter's pattern may claim; every adapter test runs its spec over them. */
export const OWN_ADDRESS_SAMPLES = [
  "/", "/forum", "/forum/thread/2024-plans", "/forum/thread/2024-plans?page=2", "/forum/thread/12-x/edit/abc",
  "/forum/2020-archive", "/forum/2020-archive/new", "/u/123-abc", "/articles/2024-recap", "/members", "/members?page=2",
  "/api/plugins/xentium-forum/threads/2024-plans", "/api/plugins/xentium-forum/posts/5", "/api/users/5",
  "/uploads/avatars/12-a.png", "/assets/index-12.js", "/legal/privacy", "/search?q=p=1",
];
