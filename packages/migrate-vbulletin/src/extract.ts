import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  attachLastSeen, birthdayOf, keyset,
  toneOfClass, type ExtractResult, type ImportError, type ImportedBan, type ImportedGroup, type ImportedPrefix, type ImportedWarning, type ImportedBlock, type ImportedConversation, type ImportedFollow,
  type ImportedForumNode, type ImportedMessage, type ImportedPost, type ImportedPostLike, type ImportedProfileComment,
  type ImportedSubscription, type ImportedThread, type ImportedUser, type MigrationReporter, type Rows,
} from "@xentium/migrate-core";
import { unescapeVb, vbBbcodeToHtml } from "./bbcode.js";
import {
  LAST_STOCK_GROUP, mapChannel, mapForum, mapNodePost, mapPost, mapThread, mapTopic, mapUser, nodeSkipReason, postSkipReason,
  threadSkipReason, type VbChannelRow, type VbForumRow, type VbNodeRow, type VbPostRow, type VbThreadRow, type VbUserRow,
} from "./mapping.js";

/**
 * vBulletin extractors. Thin SELECTs; the interpretation lives in mapping.ts.
 *
 * Two layouts behind one adapter:
 *   vBulletin 3/4: classic tables (user, forum, thread, post).
 *   vBulletin 5/6: one `node` tree; channels hold topics, topics hold replies and
 *                  comments. We take the channels under the Forum root only, so
 *                  blogs, groups and private messages (also nodes) stay out.
 *
 * The table prefix is empty by default (vBulletin's installer default).
 */

export interface VbSource {
  db: string;
  tablePrefix: string;
  /** The vBulletin folder, for avatars stored as files. */
  filesDir?: string;
}

export type VbLayout = "classic" | "nodes";

/** The Forum root channel, by the GUID vBulletin 5 gives it on install. */
export const FORUM_ROOT_GUID = "vbulletin-4ecbdf567f2c35.70389590";

type Conn = mysql.Connection;

async function rows<T>(conn: Conn, sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await conn.query(sql, params);
  return r as T[];
}

/** Rows from an optional table: [] when the board doesn't have it. */
async function optional<T>(conn: Conn, sql: string, onMissing: () => void): Promise<T[]> {
  try { return await rows<T>(conn, sql); } catch { onMissing(); return []; }
}

async function total(conn: Conn, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await rows<{ n: number }>(conn, sql, params))[0]?.n ?? 0);
}

/** Opens a second connection for the paged lists (batches.ts): the extract's own is closed by then. */
type Open = () => Promise<Conn>;
const close = (c: Conn) => c.end();

export async function connect(source: VbSource): Promise<Conn> {
  return mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
}

export async function detectLayout(conn: Conn, p: string): Promise<VbLayout | null> {
  const has = async (table: string) =>
    (await rows<Record<string, string>>(conn, "SHOW TABLES LIKE ?", [`${p}${table}`])).length > 0;
  if (await has("node") && await has("contenttype")) return "nodes";
  if (await has("thread") && await has("post")) return "classic";
  return null;
}

export async function vbVersion(conn: Conn, p: string): Promise<string> {
  try {
    const r = await rows<{ value: string }>(conn, `SELECT value FROM ${p}setting WHERE varname = 'templateversion'`);
    return r[0]?.value || "unknown";
  } catch {
    return "unknown";
  }
}

/** The Forum root channel's node id in a vB5/6 board. */
export async function forumRootId(conn: Conn, p: string): Promise<number | null> {
  const byGuid = await rows<{ nodeid: number }>(conn, `SELECT nodeid FROM ${p}channel WHERE guid = ?`, [FORUM_ROOT_GUID]);
  if (byGuid[0]) return byGuid[0].nodeid;
  // A board that lost the stock GUID: the top-level channel called "Forum".
  const byTitle = await rows<{ nodeid: number }>(conn,
    `SELECT n.nodeid FROM ${p}node n JOIN ${p}channel c ON c.nodeid = n.nodeid
      WHERE n.parentid = (SELECT nodeid FROM ${p}node WHERE parentid = 0 ORDER BY nodeid LIMIT 1) AND n.title = 'Forum'`);
  return byTitle[0]?.nodeid ?? null;
}

// ── shared: users, groups, ignores ───────────────────────────────────────────

/**
 * Thread prefixes. A prefix (string id) sits in a prefix set; sets are offered per
 * forum (vB3/4 `forumprefixset`) or channel (vB5/6 `channelprefixset`). Titles are
 * phrases: `prefix_<id>_title_plain`, and the rich one hints at a colour.
 */
async function readPrefixes(conn: Conn, p: string, layout: VbLayout, reporter: MigrationReporter): Promise<ImportedPrefix[]> {
  try {
    const list = await rows<{ prefixid: string; prefixsetid: string }>(conn, `SELECT prefixid, prefixsetid FROM ${p}prefix ORDER BY displayorder, prefixid`);
    if (!list.length) return [];
    const phrases = new Map<string, string>();
    for (const ph of await rows<{ varname: string; text: string; languageid: number }>(conn,
      `SELECT varname, text, languageid FROM ${p}phrase WHERE varname LIKE 'prefix\\_%\\_title\\_%' ORDER BY languageid ASC`)) {
      // Master language (-1) first, then the default (0) overrides it.
      phrases.set(ph.varname, ph.text);
    }
    const setTable = layout === "nodes" ? "channelprefixset" : "forumprefixset";
    const setCol = layout === "nodes" ? "nodeid" : "forumid";
    const boards = new Map<string, string[]>();
    for (const r of await rows<{ id: number; prefixsetid: string }>(conn, `SELECT ${setCol} AS id, prefixsetid FROM ${p}${setTable}`).catch(() => [])) {
      boards.set(r.prefixsetid, [...(boards.get(r.prefixsetid) ?? []), String(r.id)]);
    }
    return list.map((r) => {
      const plain = phrases.get(`prefix_${r.prefixid}_title_plain`);
      const rich = phrases.get(`prefix_${r.prefixid}_title_rich`);
      // A set offered nowhere: keep the prefix for the threads that carry it, everywhere.
      return { sourceId: r.prefixid, label: unescapeVb(plain?.trim() || r.prefixid), tone: toneOfClass(rich), nodeSourceIds: boards.get(r.prefixsetid) };
    });
  } catch {
    reporter.warn("No prefix tables found: thread prefixes are not carried over.");
    return [];
  }
}

/** Which prefix each kept thread carries (vB3/4 thread.prefixid, vB5/6 node.prefixid). */
async function attachPrefixes(conn: Conn, p: string, layout: VbLayout, threads: ImportedThread[]): Promise<void> {
  const sql = layout === "nodes"
    ? `SELECT nodeid AS id, prefixid FROM ${p}node WHERE starter = nodeid AND prefixid <> ''`
    : `SELECT threadid AS id, prefixid FROM ${p}thread WHERE prefixid <> ''`;
  const tagged = await rows<{ id: number; prefixid: string }>(conn, sql).catch(() => []);
  const byThread = new Map(tagged.map((r) => [String(r.id), r.prefixid]));
  for (const th of threads) th.prefixSourceId = byThread.get(th.sourceId);
}

/** Member groups past the stock eight. vBulletin 5/6 adds its own system groups
 *  (channel owners, social groups…), marked by systemgroupid; those stay out. */
async function readGroups(conn: Conn, p: string, reporter: MigrationReporter): Promise<ImportedGroup[]> {
  try {
    const system = (await rows(conn, `SHOW COLUMNS FROM ${p}usergroup LIKE 'systemgroupid'`)).length > 0;
    return (await rows<{ usergroupid: number; title: string }>(conn,
      `SELECT usergroupid, title FROM ${p}usergroup WHERE usergroupid > ${LAST_STOCK_GROUP}${system ? " AND systemgroupid = 0" : ""}`))
      .map((g) => ({ sourceId: String(g.usergroupid), name: unescapeVb(g.title) }));
  } catch {
    reporter.warn("Member groups not readable: only staff and members are told apart.");
    return [];
  }
}

async function readUsers(conn: Conn, p: string, layout: VbLayout, skipped: ImportError[]): Promise<ImportedUser[]> {
  const cols = layout === "nodes" ? "token, scheme, secret" : "password, salt";
  const users: ImportedUser[] = [];
  for (const row of await rows<VbUserRow>(conn,
    `SELECT userid, username, email, joindate, usergroupid, membergroupids, ${cols} FROM ${p}user`)) {
    const user = mapUser(row);
    if (user) users.push(user);
    else skipped.push({ entity: "user", sourceId: String(row.userid), reason: "missing email or username" });
  }
  // Last visit: the later of lastactivity and lastvisit (either may be missing).
  attachLastSeen(users, await optional<{ id: number; at: number }>(conn,
    `SELECT userid AS id, GREATEST(COALESCE(lastactivity, 0), COALESCE(lastvisit, 0)) AS at FROM ${p}user`, () => undefined));
  return users;
}

/** Birthday ("mm-dd-yyyy") and homepage, read apart so a board without them still imports. */
async function addPersonalInfo(conn: Conn, p: string, users: ImportedUser[]): Promise<void> {
  const info = await optional<{ userid: number; birthday: string | null; homepage: string | null }>(conn,
    `SELECT userid, birthday, homepage FROM ${p}user`, () => undefined);
  const byId = new Map(info.map((r) => [String(r.userid), r]));
  for (const u of users) {
    const r = byId.get(u.sourceId);
    if (!r) continue;
    const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(r.birthday ?? "");
    if (m) u.birthday = birthdayOf(Number(m[3]), Number(m[1]), Number(m[2]));
    if (r.homepage && r.homepage !== "http://") u.website = r.homepage;
  }
}

/**
 * Avatars. vBulletin keeps them in the customavatar table, either as bytes in the row
 * or, when the board stores avatars as files, at <avatarpath>/avatar<userid>_<revision>.<ext>.
 */
async function addAvatars(conn: Conn, p: string, users: ImportedUser[], filesDir: string | undefined, reporter: MigrationReporter): Promise<void> {
  const rows = await optional<{ userid: number; filedata: Buffer | null; extension?: string | null; avatarrevision: number | null }>(conn,
    `SELECT ca.*, u.avatarrevision FROM ${p}customavatar ca JOIN ${p}user u ON u.userid = ca.userid`, () => undefined);
  if (!rows.length) return;
  const setting = await optional<{ value: string }>(conn, `SELECT value FROM ${p}setting WHERE varname = 'avatarpath'`, () => undefined);
  const dir = (setting[0]?.value ?? "./customavatars").replace(/^\.\//, "");
  let needFiles = 0;
  for (const r of rows) {
    const u = users.find((x) => x.sourceId === String(r.userid));
    if (!u) continue;
    if (r.filedata && r.filedata.length) { u.avatar = { data: Buffer.from(r.filedata) }; continue; }
    if (!filesDir) { needFiles++; continue; }
    const file = path.join(filesDir, dir, `avatar${r.userid}_${r.avatarrevision ?? 1}.${r.extension || "gif"}`);
    if (fs.existsSync(file)) u.avatar = { path: file };
  }
  if (needFiles) reporter.warn(`${needFiles} avatar(s) are files: pass --files <vBulletin folder> to bring them over.`);
}

/** Bans still in force (userban: liftdate 0 = permanent). */
async function readBans(conn: Conn, p: string, reporter: MigrationReporter): Promise<ImportedBan[]> {
  return (await optional<{ userid: number; adminid: number; bandate: number; liftdate: number; reason: string }>(conn,
    `SELECT userid, adminid, bandate, liftdate, reason FROM ${p}userban`,
    () => reporter.warn("No userban table found: bans are not carried over.")))
    .map((r) => ({ userSourceId: String(r.userid), issuedBySourceId: r.adminid ? String(r.adminid) : undefined,
      reason: unescapeVb(r.reason ?? ""), expiresAt: r.liftdate ? new Date(r.liftdate * 1000) : null, createdAt: new Date(r.bandate * 1000) }));
}

/**
 * Infractions still in force: action 0 (1 = expired, 2 = reversed), and no expiry or
 * one in the future. vB3/4 keep the issuer and date on the row; vB5/6 make each
 * infraction a node, so they come from the node.
 */
async function readWarnings(conn: Conn, p: string, layout: VbLayout, reporter: MigrationReporter): Promise<ImportedWarning[]> {
  const sql = layout === "classic"
    ? `SELECT userid AS target, whoadded AS issuer, dateline AS created, expires, customreason, note FROM ${p}infraction
        WHERE action = 0 AND (expires = 0 OR expires > UNIX_TIMESTAMP())`
    : `SELECT i.infracteduserid AS target, n.userid AS issuer, n.publishdate AS created, i.expires, i.customreason, i.note
         FROM ${p}infraction i JOIN ${p}node n ON n.nodeid = i.nodeid
        WHERE i.action = 0 AND (i.expires = 0 OR i.expires > UNIX_TIMESTAMP())`;
  return (await optional<{ target: number; issuer: number; created: number; expires: number; customreason: string | null; note: string | null }>(conn,
    sql, () => reporter.warn("No infraction table found: warnings are not carried over.")))
    .filter((r) => r.target > 0)
    .map((r) => ({ userSourceId: String(r.target), issuedBySourceId: r.issuer ? String(r.issuer) : undefined,
      reason: unescapeVb(r.customreason || r.note || ""), expiresAt: r.expires ? new Date(r.expires * 1000) : null,
      createdAt: new Date(r.created * 1000) }));
}

/** Attaches tags (tag text per content id) to the imported threads. */
function attachTags(threads: ImportedThread[], tagRows: Array<{ id: number; tagtext: string }>): void {
  const byId = new Map<string, string[]>();
  for (const r of tagRows) byId.set(String(r.id), [...(byId.get(String(r.id)) ?? []), unescapeVb(r.tagtext)]);
  for (const t of threads) t.tags = byId.get(t.sourceId);
}

// ── vBulletin 3 / 4 ──────────────────────────────────────────────────────────

async function extractClassic(conn: Conn, open: Open, p: string, reporter: MigrationReporter, skipped: ImportError[], filesDir?: string) {
  const users = await readUsers(conn, p, "classic", skipped);

  const forumNodes: ImportedForumNode[] = [];
  for (const row of await rows<VbForumRow>(conn,
    `SELECT forumid, parentid, title, description, displayorder, options, link FROM ${p}forum ORDER BY displayorder`)) {
    const node = mapForum(row);
    if (node) forumNodes.push(node);
    else skipped.push({ entity: "forum_node", sourceId: String(row.forumid), reason: "link forum (no content)" });
  }

  const threads: ImportedThread[] = [];
  const kept = new Set<number>();
  for (const row of await rows<VbThreadRow>(conn,
    `SELECT threadid, forumid, title, postuserid, dateline, open, sticky, views, visible FROM ${p}thread`)) {
    const why = threadSkipReason(row);
    if (why) { skipped.push({ entity: "thread", sourceId: String(row.threadid), reason: why }); continue; }
    threads.push(mapThread(row));
    kept.add(row.threadid);
  }

  const edits = new Map<number, number>();
  for (const e of await optional<{ postid: number; dateline: number }>(conn,
    `SELECT postid, MAX(dateline) AS dateline FROM ${p}editlog GROUP BY postid`,
    () => reporter.warn("No editlog table found: edit dates are not carried over."))) {
    edits.set(e.postid, e.dateline);
  }

  // Posts in pages: a big board's bodies don't fit in memory (batches.ts).
  const posts: Rows<ImportedPost> = keyset({
    total: await total(conn, `SELECT COUNT(*) n FROM ${p}post`),
    connect: open, close,
    fetch: (c, after, limit) => rows<Omit<VbPostRow, "edited">>(c,
      `SELECT postid, threadid, userid, dateline, pagetext, visible FROM ${p}post WHERE postid > ? ORDER BY postid LIMIT ?`, [after, limit]),
    key: (row) => row.postid,
    map: (page) => page.flatMap((row) => {
      if (!kept.has(row.threadid)) {
        skipped.push({ entity: "post", sourceId: String(row.postid), reason: "its thread was not imported" });
        return [];
      }
      const why = postSkipReason(row);
      if (why) { skipped.push({ entity: "post", sourceId: String(row.postid), reason: why }); return []; }
      return [mapPost({ ...row, edited: edits.get(row.postid) ?? null })];
    }),
  });

  // vB3/4 has no likes in core (that was always an add-on), and its buddy list is
  // private, so only ignores carry over, as blocks.
  const blocks: ImportedBlock[] = (await optional<{ userid: number; relationid: number }>(conn,
    `SELECT userid, relationid FROM ${p}userlist WHERE type = 'ignore'`,
    () => reporter.warn("No userlist table found: ignore lists are not carried over.")))
    .map((r) => ({ blockerSourceId: String(r.userid), blockedSourceId: String(r.relationid) }));

  await addPersonalInfo(conn, p, users);
  await addAvatars(conn, p, users, filesDir, reporter);

  // Tags: vB4 keeps them per content type, vB3.8 had a thread-only table.
  let tagRows = await optional<{ id: number; tagtext: string }>(conn,
    `SELECT tc.contentid AS id, t.tagtext FROM ${p}tagcontent tc JOIN ${p}tag t ON t.tagid = tc.tagid
       JOIN ${p}contenttype ct ON ct.contenttypeid = tc.contenttypeid WHERE ct.class = 'Thread'`, () => undefined);
  if (!tagRows.length) {
    tagRows = await optional<{ id: number; tagtext: string }>(conn,
      `SELECT tt.threadid AS id, t.tagtext FROM ${p}tagthread tt JOIN ${p}tag t ON t.tagid = tt.tagid`, () => undefined);
  }
  attachTags(threads, tagRows);

  const subscriptions: ImportedSubscription[] = (await optional<{ userid: number; threadid: number }>(conn,
    `SELECT userid, threadid FROM ${p}subscribethread`, () => reporter.warn("No subscribethread table found: thread subscriptions are not carried over.")))
    .filter((r) => kept.has(r.threadid))
    .map((r) => ({ userSourceId: String(r.userid), threadSourceId: String(r.threadid) }));

  const profileComments: ImportedProfileComment[] = (await optional<{ vmid: number; userid: number; postuserid: number; dateline: number; pagetext: string }>(conn,
    `SELECT vmid, userid, postuserid, dateline, pagetext FROM ${p}visitormessage WHERE state = 'visible' AND postuserid > 0`,
    () => reporter.warn("No visitormessage table found: profile walls are not carried over.")))
    .map((r) => ({ sourceId: `vm${r.vmid}`, profileUserSourceId: String(r.userid), authorSourceId: String(r.postuserid),
      bodyHtml: vbBbcodeToHtml(r.pagetext ?? ""), createdAt: new Date(r.dateline * 1000) }));

  const pms = await classicMessages(conn, open, p, reporter);
  await attachPrefixes(conn, p, "classic", threads);
  return { users, groups: await readGroups(conn, p, reporter), forumNodes, prefixes: await readPrefixes(conn, p, "classic", reporter), threads, posts, postLikes: [] as ImportedPostLike[], follows: [] as ImportedFollow[], blocks,
    subscriptions, bans: await readBans(conn, p, reporter), warnings: await readWarnings(conn, p, "classic", reporter), profileComments, ...pms };
}

/**
 * vB3/4 private messages. `pmtext` is a message as written; `pm` is each member's
 * copy of it. A reply's copies point (parentpmid) at the copy that was answered, so we
 * follow those links back to the first message and group the chain as one conversation.
 */
async function classicMessages(conn: Conn, open: Open, p: string, reporter: MigrationReporter):
  Promise<{ conversations: ImportedConversation[]; messages: Rows<ImportedMessage> }> {
  // A light first pass for the conversations; the texts themselves come in pages.
  const texts = await optional<{ pmtextid: number; fromuserid: number; title: string; dateline: number }>(conn,
    `SELECT pmtextid, fromuserid, title, dateline FROM ${p}pmtext ORDER BY dateline, pmtextid`,
    () => reporter.warn("No pmtext table found: private messages are not carried over."));
  if (!texts.length) return { conversations: [], messages: [] };
  const copies = await rows<{ pmid: number; pmtextid: number; userid: number; parentpmid: number }>(conn,
    `SELECT pmid, pmtextid, userid, parentpmid FROM ${p}pm`);

  const textOfCopy = new Map(copies.map((c) => [c.pmid, c.pmtextid]));
  const parentText = new Map<number, number>();
  for (const c of copies) {
    const parent = c.parentpmid ? textOfCopy.get(c.parentpmid) : undefined;
    if (parent && parent !== c.pmtextid) parentText.set(c.pmtextid, parent);
  }
  const rootOf = (id: number) => {
    const seen = new Set<number>();
    let cur = id;
    while (parentText.has(cur) && !seen.has(cur)) { seen.add(cur); cur = parentText.get(cur)!; }
    return cur;
  };
  const holders = new Map<number, Set<number>>();
  for (const c of copies) holders.set(c.pmtextid, (holders.get(c.pmtextid) ?? new Set()).add(c.userid));

  const byRoot = new Map<number, ImportedConversation>();
  for (const t of texts) {
    const root = rootOf(t.pmtextid);
    let conv = byRoot.get(root);
    if (!conv) {
      conv = { sourceId: `pm${root}`, starterSourceId: String(t.fromuserid), title: unescapeVb(t.title || ""),
        participants: [], createdAt: new Date(t.dateline * 1000) };
      byRoot.set(root, conv);
    }
    for (const u of [t.fromuserid, ...(holders.get(t.pmtextid) ?? [])]) {
      if (u && !conv.participants.some((x) => x.userSourceId === String(u))) conv.participants.push({ userSourceId: String(u) });
    }
  }
  const messages = keyset({
    total: texts.length, connect: open, close,
    fetch: (c, after, limit) => rows<{ pmtextid: number; fromuserid: number; message: string | null; dateline: number }>(c,
      `SELECT pmtextid, fromuserid, message, dateline FROM ${p}pmtext WHERE pmtextid > ? ORDER BY pmtextid LIMIT ?`, [after, limit]),
    key: (t) => t.pmtextid,
    map: (page) => page.map((t) => ({ sourceId: String(t.pmtextid), conversationSourceId: `pm${rootOf(t.pmtextid)}`,
      senderSourceId: String(t.fromuserid), bodyHtml: vbBbcodeToHtml(t.message ?? ""), createdAt: new Date(t.dateline * 1000) })),
  });
  return { conversations: [...byRoot.values()], messages };
}

// ── vBulletin 5 / 6 ──────────────────────────────────────────────────────────

async function extractNodes(conn: Conn, open: Open, p: string, reporter: MigrationReporter, skipped: ImportError[], filesDir?: string) {
  const users = await readUsers(conn, p, "nodes", skipped);

  const root = await forumRootId(conn, p);
  if (root == null) throw new Error("Could not find the Forum channel in this vBulletin 5/6 board.");

  const channelRows = await rows<VbChannelRow>(conn,
    `SELECT n.nodeid, n.parentid, n.title, n.description, n.displayorder, c.category
       FROM ${p}node n
       JOIN ${p}channel c ON c.nodeid = n.nodeid
       JOIN ${p}closure cl ON cl.child = n.nodeid AND cl.parent = ? AND cl.depth > 0
      ORDER BY cl.depth, n.displayorder`, [root]);
  const forumNodes = channelRows.map((r) => mapChannel(r, root));
  const channelIds = new Set(channelRows.map((r) => r.nodeid));

  // Content nodes: topic starters (starter = nodeid) and everything below them.
  // `text` holds the BBCode; a node without a text row (a photo, say) has nothing to move.
  const views = new Map<number, number>();
  for (const v of await optional<{ nodeid: number; count: number }>(conn,
    `SELECT nodeid, count FROM ${p}nodeview`, () => reporter.warn("No nodeview table found: view counts start at 0."))) {
    views.set(v.nodeid, v.count);
  }
  const edits = new Map<number, number>();
  for (const e of await optional<{ nodeid: number; dateline: number }>(conn,
    `SELECT nodeid, MAX(dateline) AS dateline FROM ${p}editlog GROUP BY nodeid`, () => undefined)) {
    edits.set(e.nodeid, e.dateline);
  }

  // Content nodes: topic starters (starter = nodeid) and everything below them. The
  // topics come first, without their text (a light pass that decides which come over);
  // the text of every post comes in pages after (batches.ts).
  // `text` holds the BBCode; a node without a text row (a photo, say) has nothing to move.
  const content = (where: string) => `
    SELECT n.nodeid, n.parentid, n.starter, n.userid, n.title, n.publishdate, n.open, n.sticky,
           n.showpublished, n.showapproved, TEXT_COLUMN
      FROM ${p}node n
      JOIN ${p}contenttype ct ON ct.contenttypeid = n.contenttypeid
      LEFT JOIN ${p}text t ON t.nodeid = n.nodeid
     WHERE n.starter > 0 AND ct.class <> 'Channel' AND ${where}`;
  const asRow = (base: Omit<VbNodeRow, "edited" | "views">): VbNodeRow =>
    ({ ...base, edited: edits.get(base.nodeid) ?? null, views: views.get(base.nodeid) ?? null });

  const threads: ImportedThread[] = [];
  const kept = new Set<number>();
  // "" stands in for the text here: the skip reasons only ask whether there is one.
  for (const base of await rows<Omit<VbNodeRow, "edited" | "views">>(conn,
    content("n.starter = n.nodeid").replace("TEXT_COLUMN", "CASE WHEN t.rawtext IS NULL THEN NULL ELSE '' END AS rawtext"))) {
    const row = asRow(base);
    if (!channelIds.has(row.parentid)) continue; // a blog entry, group topic, message, …: not the forum
    const why = nodeSkipReason(row);
    if (why) { skipped.push({ entity: "thread", sourceId: String(row.nodeid), reason: why }); continue; }
    threads.push(mapTopic(row));
    kept.add(row.nodeid);
  }

  const posts: Rows<ImportedPost> = keyset({
    total: await total(conn, `SELECT COUNT(*) n FROM ${p}node n JOIN ${p}contenttype ct ON ct.contenttypeid = n.contenttypeid
      WHERE n.starter > 0 AND ct.class <> 'Channel'`),
    connect: open, close,
    fetch: (c, after, limit) => rows<Omit<VbNodeRow, "edited" | "views">>(c,
      `${content("n.nodeid > ?").replace("TEXT_COLUMN", "t.rawtext")} ORDER BY n.nodeid LIMIT ?`, [after, limit]),
    key: (row) => row.nodeid,
    map: (page) => page.flatMap((base) => {
      const row = asRow(base);
      if (!kept.has(row.starter)) return []; // under a topic we didn't take (or not in the forum at all)
      if (row.starter !== row.nodeid) {
        const why = nodeSkipReason(row);
        if (why) { skipped.push({ entity: "post", sourceId: String(row.nodeid), reason: why }); return []; }
      }
      return [mapNodePost(row)]; // the topic's own first post, replies and comments on replies
    }),
  });

  // Likes are reputation entries on a node. Only those on posts we bring over count:
  // under a topic we kept, and a post that is published, approved and has an author and text.
  const postLikes: ImportedPostLike[] = (await optional<{ nodeid: number; starter: number; whoadded: number; dateline: number; ok: number }>(conn,
    `SELECT r.nodeid, n.starter, r.whoadded, r.dateline,
            (n.showpublished = 1 AND n.showapproved = 1 AND n.userid > 0 AND t.rawtext IS NOT NULL) AS ok
       FROM ${p}reputation r JOIN ${p}node n ON n.nodeid = r.nodeid LEFT JOIN ${p}text t ON t.nodeid = n.nodeid
      WHERE r.reputation > 0`,
    () => reporter.warn("No reputation table found: likes are not carried over.")))
    .filter((r) => kept.has(r.starter) && Number(r.ok) === 1 && r.whoadded)
    .map((r) => ({ postSourceId: String(r.nodeid), userSourceId: String(r.whoadded), createdAt: new Date(r.dateline * 1000) }));

  const relations = await optional<{ userid: number; relationid: number; type: string; friend: string | null }>(conn,
    `SELECT userid, relationid, type, friend FROM ${p}userlist WHERE type IN ('follow', 'ignore')`,
    () => reporter.warn("No userlist table found: follows and ignore lists are not carried over."));
  const follows: ImportedFollow[] = relations
    .filter((r) => r.type === "follow" && r.friend !== "pending" && r.friend !== "denied")
    .map((r) => ({ followerSourceId: String(r.userid), followingSourceId: String(r.relationid) }));
  const blocks: ImportedBlock[] = relations
    .filter((r) => r.type === "ignore")
    .map((r) => ({ blockerSourceId: String(r.userid), blockedSourceId: String(r.relationid) }));

  await addPersonalInfo(conn, p, users);
  await addAvatars(conn, p, users, filesDir, reporter);

  attachTags(threads, await optional<{ id: number; tagtext: string }>(conn,
    `SELECT tn.nodeid AS id, t.tagtext FROM ${p}tagnode tn JOIN ${p}tag t ON t.tagid = tn.tagid`, () => undefined));

  const subscriptions: ImportedSubscription[] = (await optional<{ userid: number; discussionid: number }>(conn,
    `SELECT userid, discussionid FROM ${p}subscribediscussion`,
    () => reporter.warn("No subscribediscussion table found: topic subscriptions are not carried over.")))
    .filter((r) => kept.has(r.discussionid))
    .map((r) => ({ userSourceId: String(r.userid), threadSourceId: String(r.discussionid) }));

  // Visitor messages are nodes aimed at a member (setfor = the profile's owner).
  const profileComments: ImportedProfileComment[] = (await optional<{ nodeid: number; userid: number; setfor: number; publishdate: number; rawtext: string }>(conn,
    `SELECT n.nodeid, n.userid, n.setfor, n.publishdate, t.rawtext FROM ${p}node n JOIN ${p}text t ON t.nodeid = n.nodeid
      WHERE n.setfor > 0 AND n.starter = n.nodeid AND n.showpublished = 1 AND n.showapproved = 1 AND n.userid > 0`,
    () => reporter.warn("Visitor messages not readable: profile walls are not carried over.")))
    .map((r) => ({ sourceId: `vm${r.nodeid}`, profileUserSourceId: String(r.setfor), authorSourceId: String(r.userid),
      bodyHtml: vbBbcodeToHtml(r.rawtext ?? ""), createdAt: new Date(r.publishdate * 1000) }));

  const pms = await nodeMessages(conn, open, p, reporter);
  await attachPrefixes(conn, p, "nodes", threads);
  return { users, groups: await readGroups(conn, p, reporter), forumNodes, prefixes: await readPrefixes(conn, p, "nodes", reporter), threads, posts, postLikes, follows, blocks,
    subscriptions, bans: await readBans(conn, p, reporter), warnings: await readWarnings(conn, p, "nodes", reporter), profileComments, ...pms };
}

/**
 * vB5/6 private messages are nodes too: the starter node is the conversation, the
 * nodes under it are replies. `privatemessage.msgtype` separates real messages from
 * notifications and friend requests; `sentto` lists who holds each one (and whether
 * they deleted it).
 */
async function nodeMessages(conn: Conn, open: Open, p: string, reporter: MigrationReporter):
  Promise<{ conversations: ImportedConversation[]; messages: Rows<ImportedMessage> }> {
  // A light first pass for the conversations; the texts come in pages.
  const pmRows = await optional<{ nodeid: number; starter: number; userid: number; title: string | null; publishdate: number }>(conn,
    `SELECT n.nodeid, n.starter, n.userid, n.title, n.publishdate
       FROM ${p}node n
       JOIN ${p}privatemessage pm ON pm.nodeid = n.nodeid AND pm.msgtype = 'message'
       LEFT JOIN ${p}text t ON t.nodeid = n.nodeid
      WHERE n.starter > 0
      ORDER BY n.publishdate, n.nodeid`,
    () => reporter.warn("No privatemessage table found: private messages are not carried over."));
  if (!pmRows.length) return { conversations: [], messages: [] };
  const sent = await optional<{ nodeid: number; userid: number; deleted: number }>(conn,
    `SELECT nodeid, userid, deleted FROM ${p}sentto`, () => undefined);
  const holders = new Map<number, Array<{ userid: number; deleted: number }>>();
  for (const r of sent) holders.set(r.nodeid, [...(holders.get(r.nodeid) ?? []), r]);

  const byStarter = new Map<number, ImportedConversation>();
  for (const m of pmRows) {
    let conv = byStarter.get(m.starter);
    if (!conv) {
      conv = { sourceId: `pm${m.starter}`, starterSourceId: String(m.userid), title: unescapeVb(m.title ?? ""),
        participants: [], createdAt: new Date(m.publishdate * 1000) };
      byStarter.set(m.starter, conv);
    }
    for (const h of [{ userid: m.userid, deleted: 0 }, ...(holders.get(m.nodeid) ?? [])]) {
      if (!h.userid) continue;
      const existing = conv.participants.find((x) => x.userSourceId === String(h.userid));
      if (!existing) conv.participants.push({ userSourceId: String(h.userid), archived: h.deleted === 1 });
      else if (!h.deleted) existing.archived = false;
    }
  }
  const messages = keyset({
    total: pmRows.length, connect: open, close,
    fetch: (c, after, limit) => rows<{ nodeid: number; starter: number; userid: number; publishdate: number; rawtext: string | null }>(c,
      `SELECT n.nodeid, n.starter, n.userid, n.publishdate, t.rawtext
         FROM ${p}node n
         JOIN ${p}privatemessage pm ON pm.nodeid = n.nodeid AND pm.msgtype = 'message'
         LEFT JOIN ${p}text t ON t.nodeid = n.nodeid
        WHERE n.starter > 0 AND n.nodeid > ? ORDER BY n.nodeid LIMIT ?`, [after, limit]),
    key: (m) => m.nodeid,
    map: (page) => page.filter((m) => m.rawtext != null).map((m) => ({ sourceId: String(m.nodeid), conversationSourceId: `pm${m.starter}`,
      senderSourceId: String(m.userid), bodyHtml: vbBbcodeToHtml(m.rawtext!), createdAt: new Date(m.publishdate * 1000) })),
  });
  return { conversations: [...byStarter.values()], messages };
}

export async function extractVbulletin(source: VbSource, reporter: MigrationReporter): Promise<ExtractResult> {
  const conn = await connect(source);
  const p = source.tablePrefix;
  const skipped: ImportError[] = [];
  try {
    const layout = await detectLayout(conn, p);
    if (!layout) throw new Error(`No vBulletin tables found${p ? ` with the prefix "${p}"` : ""}. Is --prefix right?`);
    const version = await vbVersion(conn, p);
    reporter.info(`Source: vBulletin ${version} (${layout === "nodes" ? "5/6 node tree" : "3/4 classic tables"})`);

    const data = layout === "nodes"
      ? await extractNodes(conn, () => connect(source), p, reporter, skipped, source.filesDir)
      : await extractClassic(conn, () => connect(source), p, reporter, skipped, source.filesDir);

    return {
      sourceInfo: `vBulletin ${version}`,
      categories: [],
      articles: [],
      comments: [],
      ...data,
      skipped,
    };
  } finally {
    await conn.end();
  }
}
