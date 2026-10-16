import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { attachLastSeen, birthdayOf, keyset, type ExtractResult, type ImportError, type ImportedBan, type ImportedWarning, type ImportedConversation, type ImportedMessage,
  type ImportedGroup, type ImportedSubscription, type ImportedUser, type MigrationReporter, type Rows } from "@xentium/migrate-core";
import { convertPostText } from "./postText.js";
import {
  decodeEntities, mapForum, mapPost, mapTopic, mapUser, USER_TYPE_BOT,
  type PhpbbForumRow, type PhpbbPostRow, type PhpbbTopicRow, type PhpbbUserRow,
} from "./mapping.js";

/**
 * phpBB extractor — a thin set of SELECTs against the source MySQL database;
 * all interpretation lives in mapping.ts (unit-tested without MySQL).
 *
 * Supported: phpBB 3.1+ (3.0 predates the visibility columns and bcrypt —
 * boards should upgrade to current phpBB first; inspect() reports this).
 */

export interface PhpbbSource {
  db: string;          // mysql://user:pass@host:3306/phpbb
  tablePrefix: string; // default "phpbb_"
  /** The phpBB folder, for uploaded avatar files. */
  filesDir?: string;
}

export async function phpbbVersion(source: PhpbbSource): Promise<string> {
  const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
  try {
    const [rows] = await conn.query(
      `SELECT config_value FROM ${source.tablePrefix}config WHERE config_name = 'version'`,
    );
    return String((rows as Array<{ config_value: string }>)[0]?.config_value ?? "unknown");
  } finally {
    await conn.end();
  }
}

async function total(conn: mysql.Connection, sql: string): Promise<number> {
  const [rows] = await conn.query(sql);
  return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
}

export async function extractPhpbb(
  source: PhpbbSource,
  reporter: MigrationReporter,
): Promise<ExtractResult> {
  const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
  const p = source.tablePrefix;
  const skipped: ImportError[] = [];

  try {
    const version = await (async () => {
      const [rows] = await conn.query(`SELECT config_value FROM ${p}config WHERE config_name = 'version'`);
      return String((rows as Array<{ config_value: string }>)[0]?.config_value ?? "unknown");
    })();
    reporter.info(`Source: phpBB ${version}`);

    // ── users (bots/anonymous excluded) + best-effort role mapping ─────────
    const [userRows] = await conn.query(
      `SELECT user_id, username, user_email, user_password, user_regdate, user_type
       FROM ${p}users WHERE user_type <> ?`, [USER_TYPE_BOT],
    );
    const [roleRows] = await conn.query(
      `SELECT ug.user_id, g.group_name
       FROM ${p}user_group ug JOIN ${p}groups g ON g.group_id = ug.group_id
       WHERE g.group_name IN ('ADMINISTRATORS', 'GLOBAL_MODERATORS') AND ug.user_pending = 0`,
    );
    const roleByUser = new Map<number, "admin" | "moderator">();
    for (const r of roleRows as Array<{ user_id: number; group_name: string }>) {
      const role = r.group_name === "ADMINISTRATORS" ? "admin" : "moderator";
      // Admin wins when a user is in both groups.
      if (roleByUser.get(r.user_id) !== "admin") roleByUser.set(r.user_id, role);
    }

    // Personal info: phpBB keeps the birthday as "d-m-Y" (space-padded), the website
    // in its stock profile field. Each read is optional so an older board still imports.
    const birthdays = new Map<number, string | undefined>();
    try {
      const [rows] = await conn.query(`SELECT user_id, user_birthday FROM ${p}users WHERE user_birthday <> ''`);
      for (const r of rows as Array<{ user_id: number; user_birthday: string }>) {
        const m = /^\s*(\d+)-\s*(\d+)-\s*(\d+)\s*$/.exec(r.user_birthday);
        if (m) birthdays.set(r.user_id, birthdayOf(Number(m[3]), Number(m[2]), Number(m[1])));
      }
    } catch { /* no birthday column on this board */ }
    const websites = new Map<number, string>();
    try {
      const [rows] = await conn.query(`SELECT user_id, pf_phpbb_website FROM ${p}profile_fields_data WHERE pf_phpbb_website <> ''`);
      for (const r of rows as Array<{ user_id: number; pf_phpbb_website: string }>) websites.set(r.user_id, r.pf_phpbb_website);
    } catch { /* no website profile field */ }

    const users: ImportedUser[] = [];
    for (const row of userRows as PhpbbUserRow[]) {
      const base = mapUser(row, roleByUser.get(row.user_id));
      const user = base ? { ...base, birthday: birthdays.get(row.user_id), website: websites.get(row.user_id) } : base;
      if (user) users.push(user);
      else skipped.push({ entity: "user", sourceId: String(row.user_id), reason: "missing email or username" });
    }

    // Last visit (user_lastvisit; 0 = never).
    try {
      const [rows] = await conn.query(`SELECT user_id AS id, user_lastvisit AS at FROM ${p}users`);
      attachLastSeen(users, rows as Array<{ id: number; at: number }>);
    } catch { /* no last-visit column */ }

    // ── member groups beyond the built-in ones (group_type 3 = phpBB's special
    //    groups: guests, registered, moderators, administrators, bots…) ─────────
    const groups: ImportedGroup[] = [];
    try {
      const [rows] = await conn.query(`SELECT group_id, group_name FROM ${p}groups WHERE group_type <> 3`);
      for (const g of rows as Array<{ group_id: number; group_name: string }>) {
        groups.push({ sourceId: String(g.group_id), name: decodeEntities(g.group_name) });
      }
      const ids = new Set(groups.map((g) => g.sourceId));
      const [members] = await conn.query(`SELECT user_id, group_id FROM ${p}user_group WHERE user_pending = 0`);
      const byUser = new Map<string, string[]>();
      for (const m of members as Array<{ user_id: number; group_id: number }>) {
        if (ids.has(String(m.group_id))) byUser.set(String(m.user_id), [...(byUser.get(String(m.user_id)) ?? []), String(m.group_id)]);
      }
      for (const u of users) u.groupSourceIds = byUser.get(u.sourceId);
    } catch { reporter.warn("Member groups not readable: only staff and members are told apart."); }

    // ── forum tree (display order = left_id) ────────────────────────────────
    const [forumRows] = await conn.query(
      `SELECT forum_id, parent_id, forum_name, forum_desc, forum_type, left_id
       FROM ${p}forums ORDER BY left_id`,
    );
    const forumNodes = [];
    let position = 0;
    for (const row of forumRows as PhpbbForumRow[]) {
      const node = mapForum(row, position++);
      if (node) forumNodes.push(node);
      else skipped.push({ entity: "forum_node", sourceId: String(row.forum_id), reason: "link forum (no content)" });
    }

    // ── topics + posts (approved only) ──────────────────────────────────────
    const [topicRows] = await conn.query(
      `SELECT topic_id, forum_id, topic_title, topic_poster, topic_time,
              topic_status, topic_type, topic_views, topic_visibility
       FROM ${p}topics`,
    );
    const threads = [];
    for (const row of topicRows as PhpbbTopicRow[]) {
      if (row.topic_visibility !== 1) {
        skipped.push({ entity: "thread", sourceId: String(row.topic_id), reason: "not approved/visible" });
        continue;
      }
      threads.push(mapTopic(row));
    }

    // Posts in pages: a big board's bodies don't fit in memory (batches.ts).
    const posts = keyset({
      total: await total(conn, `SELECT COUNT(*) n FROM ${p}posts`),
      connect: () => mysql.createConnection({ uri: source.db, charset: "utf8mb4" }),
      close: (c) => c.end(),
      fetch: async (c, after, limit) => (await c.query(
        `SELECT post_id, topic_id, poster_id, post_time, post_edit_time,
                post_text, bbcode_uid, post_visibility
         FROM ${p}posts WHERE post_id > ? ORDER BY post_id LIMIT ?`, [after, limit]))[0] as PhpbbPostRow[],
      key: (row) => row.post_id,
      map: (rows) => rows.flatMap((row) => {
        if (row.post_visibility === 1) return [mapPost(row)];
        skipped.push({ entity: "post", sourceId: String(row.post_id), reason: "not approved/visible" });
        return [];
      }),
    });

    // ── zebra foes → blocks. phpBB has no likes and no follows; the zebra
    //    "friend" flag is a private buddy list, semantically NOT a public
    //    follow — deliberately not mapped (declared in inspect warnings).
    const blocks: Array<{ blockerSourceId: string; blockedSourceId: string }> = [];
    try {
      const [rows] = await conn.query(`SELECT user_id, zebra_id FROM ${p}zebra WHERE foe = 1`);
      for (const r of rows as Array<{ user_id: number; zebra_id: number }>) {
        blocks.push({ blockerSourceId: String(r.user_id), blockedSourceId: String(r.zebra_id) });
      }
    } catch { reporter.warn("No zebra table found — skipping foe → block mapping."); }

    // ── avatars: uploaded ones live in <avatar_path>/<avatar_salt>_<user_id>.<ext>;
    //    gallery, remote and Gravatar avatars point elsewhere and stay out.
    try {
      const [cfg] = await conn.query(`SELECT config_name, config_value FROM ${p}config WHERE config_name IN ('avatar_path', 'avatar_salt')`);
      const conf = new Map((cfg as Array<{ config_name: string; config_value: string }>).map((r) => [r.config_name, r.config_value]));
      const [rows] = await conn.query(
        `SELECT user_id, user_avatar FROM ${p}users WHERE user_avatar_type IN ('avatar.driver.upload', '1') AND user_avatar <> ''`);
      const uploaded = rows as Array<{ user_id: number; user_avatar: string }>;
      if (uploaded.length && !source.filesDir) {
        reporter.warn(`${uploaded.length} avatar(s) are files: pass --files <phpBB folder> to bring them over.`);
      } else if (uploaded.length && conf.get("avatar_salt")) {
        for (const r of uploaded) {
          const ext = r.user_avatar.split(".").pop() ?? "";
          const file = path.join(source.filesDir!, conf.get("avatar_path") ?? "images/avatars/upload", `${conf.get("avatar_salt")}_${r.user_id}.${ext}`);
          const u = users.find((x) => x.sourceId === String(r.user_id));
          if (u && fs.existsSync(file)) u.avatar = { path: file };
        }
      }
    } catch { /* no avatar columns on this board */ }

    // ── topic watches (only for topics that came over) and bans still in force.
    const topicIds = new Set(threads.map((t) => t.sourceId));
    const subscriptions: ImportedSubscription[] = [];
    try {
      const [rows] = await conn.query(`SELECT user_id, topic_id FROM ${p}topics_watch`);
      for (const r of rows as Array<{ user_id: number; topic_id: number }>) {
        if (topicIds.has(String(r.topic_id))) subscriptions.push({ userSourceId: String(r.user_id), threadSourceId: String(r.topic_id) });
      }
    } catch { reporter.warn("No topics_watch table found: topic subscriptions are not carried over."); }
    // phpBB bans can also target an IP or an email; only bans on an account come over.
    const bans: ImportedBan[] = [];
    try {
      const [rows] = await conn.query(
        `SELECT ban_userid, ban_start, ban_end, ban_give_reason, ban_reason FROM ${p}banlist WHERE ban_userid > 0 AND ban_exclude = 0`);
      for (const r of rows as Array<{ ban_userid: number; ban_start: number; ban_end: number; ban_give_reason: string; ban_reason: string }>) {
        bans.push({ userSourceId: String(r.ban_userid), reason: decodeEntities(r.ban_give_reason || r.ban_reason || ""),
          expiresAt: r.ban_end ? new Date(r.ban_end * 1000) : null, createdAt: new Date(r.ban_start * 1000) });
      }
    } catch { reporter.warn("No banlist table found: bans are not carried over."); }

    // Warnings: phpBB has no expiry per warning; the board's warnings_expire_days
    // decides (0 = they never expire). The reason sits in the moderator log entry.
    const warnings: ImportedWarning[] = [];
    try {
      const [cfg] = await conn.query(`SELECT config_value FROM ${p}config WHERE config_name = 'warnings_expire_days'`);
      const days = Number((cfg as Array<{ config_value: string }>)[0]?.config_value ?? 0);
      const [rows] = await conn.query(
        `SELECT w.user_id, w.warning_time, l.user_id AS issuer, l.log_data FROM ${p}warnings w
           LEFT JOIN ${p}log l ON l.log_id = w.log_id`);
      for (const r of rows as Array<{ user_id: number; warning_time: number; issuer: number | null; log_data: string | null }>) {
        const expiresAt = days > 0 ? new Date((r.warning_time + days * 86_400) * 1000) : null;
        if (expiresAt && expiresAt.getTime() <= Date.now()) continue;
        const reason = /s:\d+:"([\s\S]*?)";/.exec(r.log_data ?? "")?.[1] ?? "";
        warnings.push({ userSourceId: String(r.user_id), issuedBySourceId: r.issuer ? String(r.issuer) : undefined,
          reason: decodeEntities(reason), expiresAt, createdAt: new Date(r.warning_time * 1000) });
      }
    } catch { reporter.warn("No warnings table found: warnings are not carried over."); }

    // ── private messages → conversations. phpBB stores single messages; a reply
    //    carries its chain's first message in root_level (0 = it is the first).
    //    privmsgs_to lists everyone who has a copy; pm_deleted = they deleted theirs.
    //    Conversations come from a light first pass; the message texts come in pages.
    const conversations: ImportedConversation[] = [];
    let messages: Rows<ImportedMessage> = [];
    try {
      const [pmRows] = await conn.query(
        `SELECT msg_id, root_level, author_id, message_time, message_subject
           FROM ${p}privmsgs ORDER BY message_time, msg_id`);
      const [toRows] = await conn.query(`SELECT msg_id, user_id, pm_deleted FROM ${p}privmsgs_to`);
      const copies = new Map<number, Array<{ user_id: number; pm_deleted: number }>>();
      for (const r of toRows as Array<{ msg_id: number; user_id: number; pm_deleted: number }>) {
        copies.set(r.msg_id, [...(copies.get(r.msg_id) ?? []), r]);
      }
      const byRoot = new Map<number, ImportedConversation>();
      for (const m of pmRows as Array<{ msg_id: number; root_level: number; author_id: number; message_time: number;
        message_subject: string }>) {
        const root = m.root_level || m.msg_id;
        let c = byRoot.get(root);
        if (!c) {
          c = {
            sourceId: String(root), starterSourceId: String(m.author_id), title: decodeEntities(m.message_subject),
            participants: [], createdAt: new Date(m.message_time * 1000),
          };
          byRoot.set(root, c);
          conversations.push(c);
        }
        for (const u of [{ user_id: m.author_id, pm_deleted: 0 }, ...(copies.get(m.msg_id) ?? [])]) {
          const existing = c.participants.find((x) => x.userSourceId === String(u.user_id));
          // Archived only if they deleted every copy they had.
          if (!existing) c.participants.push({ userSourceId: String(u.user_id), archived: u.pm_deleted === 1 });
          else if (!u.pm_deleted) existing.archived = false;
        }
      }
      messages = keyset({
        total: (pmRows as unknown[]).length,
        connect: () => mysql.createConnection({ uri: source.db, charset: "utf8mb4" }),
        close: (c) => c.end(),
        fetch: async (c, after, limit) => (await c.query(
          `SELECT msg_id, root_level, author_id, message_time, message_text, bbcode_uid
             FROM ${p}privmsgs WHERE msg_id > ? ORDER BY msg_id LIMIT ?`, [after, limit]))[0] as Array<{
            msg_id: number; root_level: number; author_id: number; message_time: number; message_text: string; bbcode_uid: string }>,
        key: (m) => m.msg_id,
        map: (rows) => rows.map((m) => ({
          sourceId: String(m.msg_id),
          conversationSourceId: String(m.root_level || m.msg_id),
          senderSourceId: String(m.author_id),
          bodyHtml: convertPostText(m.message_text, m.bbcode_uid),
          createdAt: new Date(m.message_time * 1000),
        })),
      });
    } catch { reporter.warn("No private message tables found: skipping private messages."); }

    return {
      sourceInfo: `phpBB ${version}`,
      subscriptions,
      bans,
      warnings,
      conversations,
      messages,
      users,
      groups,
      categories: [],
      articles: [],
      comments: [],
      forumNodes,
      threads,
      posts,
      blocks,
      skipped,
    };
  } finally {
    await conn.end();
  }
}
