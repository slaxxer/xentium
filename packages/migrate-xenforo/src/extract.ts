import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { attachLastSeen, birthdayOf, keyset, toneOfClass, type ExtractResult, type ImportedPrefix, type ImportError, type ImportedBan, type ImportedWarning, type ImportedConversation, type ImportedMessage,
  type ImportedGroup, type ImportedPostLike, type ImportedProfileComment, type ImportedUser, type ImportedSubscription, type MigrationReporter, type Rows } from "@xentium/migrate-core";
import { xfBbcodeToHtml } from "./bbcode.js";
import {
  decodeVersionId, mapNode, mapPost, mapThread, mapUser,
  type XfNodeRow, type XfPostRow, type XfThreadRow, type XfUserRow,
} from "./mapping.js";

/**
 * XenForo 2.x extractor — thin SELECTs; interpretation lives in mapping.ts.
 * Table prefix is xf_ by default (XenForo installs rarely change it).
 */

export interface XfSource {
  db: string;
  tablePrefix: string; // default "xf_"
  /** The XenForo folder, for avatar files. */
  filesDir?: string;
}

export async function xfVersion(source: XfSource): Promise<string> {
  const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
  try {
    const [rows] = await conn.query(
      `SELECT option_value FROM ${source.tablePrefix}option WHERE option_id = 'currentVersionId'`,
    );
    const id = Number((rows as Array<{ option_value: string }>)[0]?.option_value ?? 0);
    return id ? decodeVersionId(id) : "unknown";
  } finally {
    await conn.end();
  }
}

async function total(conn: mysql.Connection, sql: string): Promise<number> {
  const [rows] = await conn.query(sql);
  return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
}

export async function extractXenforo(
  source: XfSource,
  reporter: MigrationReporter,
): Promise<ExtractResult> {
  const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
  const p = source.tablePrefix;
  const skipped: ImportError[] = [];

  try {
    const version = await xfVersion(source);
    reporter.info(`Source: XenForo ${version}`);

    // ── users + auth hashes (PHP-serialized bcrypt blobs) ──────────────────
    const [userRows] = await conn.query(
      `SELECT u.user_id, u.username, u.email, u.register_date, u.user_state,
              u.is_admin, u.is_moderator, a.scheme_class, a.data AS auth_data
       FROM ${p}user u
       LEFT JOIN ${p}user_authenticate a ON a.user_id = u.user_id`,
    );
    const users: ImportedUser[] = [];
    // Personal info lives in xf_user_profile: date of birth and website.
    const profiles = new Map<number, { dob_day: number; dob_month: number; dob_year: number; website: string }>();
    try {
      const [rows] = await conn.query(`SELECT user_id, dob_day, dob_month, dob_year, website FROM ${p}user_profile`);
      for (const r of rows as Array<{ user_id: number; dob_day: number; dob_month: number; dob_year: number; website: string }>) profiles.set(r.user_id, r);
    } catch { reporter.warn("No xf_user_profile table found: birthdays and websites are not carried over."); }
    for (const row of userRows as XfUserRow[]) {
      const base = mapUser(row);
      const prof = profiles.get(row.user_id);
      const user = base && prof
        ? { ...base, birthday: birthdayOf(prof.dob_year, prof.dob_month, prof.dob_day), website: prof.website || undefined }
        : base;
      if (user) users.push(user);
      else skipped.push({ entity: "user", sourceId: String(row.user_id), reason: "missing email or username" });
    }

    // Last visit (xf_user.last_activity).
    try {
      const [rows] = await conn.query(`SELECT user_id AS id, last_activity AS at FROM ${p}user`);
      attachLastSeen(users, rows as Array<{ id: number; at: number }>);
    } catch { /* no last-activity column */ }

    // Member groups beyond XenForo's stock four (1 guests, 2 registered, 3 administrative,
    // 4 moderating; staff come from is_admin / is_moderator). A member has a primary group
    // and a comma list of secondary ones.
    const groups: ImportedGroup[] = [];
    try {
      const [rows] = await conn.query(`SELECT user_group_id, title FROM ${p}user_group WHERE user_group_id > 4`);
      for (const g of rows as Array<{ user_group_id: number; title: string }>) groups.push({ sourceId: String(g.user_group_id), name: g.title });
      const ids = new Set(groups.map((g) => g.sourceId));
      const [members] = await conn.query(`SELECT user_id, user_group_id, secondary_group_ids FROM ${p}user`);
      const byUser = new Map<string, string[]>();
      for (const m of members as Array<{ user_id: number; user_group_id: number; secondary_group_ids: string | null }>) {
        const all = [String(m.user_group_id), ...String(m.secondary_group_ids ?? "").split(",").map((x) => x.trim())];
        byUser.set(String(m.user_id), [...new Set(all.filter((id) => ids.has(id)))]);
      }
      for (const u of users) u.groupSourceIds = byUser.get(u.sourceId);
    } catch { reporter.warn("Member groups not readable: only staff and members are told apart."); }

    // ── node tree ────────────────────────────────────────────────────────────
    const [nodeRows] = await conn.query(
      `SELECT node_id, parent_node_id, title, description, node_type_id, display_order
       FROM ${p}node ORDER BY display_order`,
    );
    const forumNodes = [];
    for (const row of nodeRows as XfNodeRow[]) {
      const node = mapNode(row);
      if (node) forumNodes.push(node);
      else skipped.push({ entity: "forum_node", sourceId: String(row.node_id), reason: `node type "${row.node_type_id}" has no content` });
    }

    // ── threads + posts (visible only) ──────────────────────────────────────
    const [threadRows] = await conn.query(
      `SELECT thread_id, node_id, title, user_id, post_date,
              discussion_state, discussion_open, sticky, view_count
       FROM ${p}thread`,
    );
    const threads = [];
    for (const row of threadRows as XfThreadRow[]) {
      if (row.discussion_state !== "visible") {
        skipped.push({ entity: "thread", sourceId: String(row.thread_id), reason: `state "${row.discussion_state}"` });
        continue;
      }
      threads.push(mapThread(row));
    }

    // Thread prefixes: xf_thread_prefix, titled by the phrase "thread_prefix.<id>" (the
    // master language), offered per forum in xf_forum_prefix; css_class picks the tone.
    const prefixes: ImportedPrefix[] = [];
    try {
      const [rows] = await conn.query(
        `SELECT tp.prefix_id, tp.css_class, ph.phrase_text
           FROM ${p}thread_prefix tp
           LEFT JOIN ${p}phrase ph ON ph.title = CONCAT('thread_prefix.', tp.prefix_id) AND ph.language_id = 0
          ORDER BY tp.display_order, tp.prefix_id`);
      const [forums] = await conn.query(`SELECT node_id, prefix_id FROM ${p}forum_prefix`);
      const boards = new Map<number, string[]>();
      for (const f of forums as Array<{ node_id: number; prefix_id: number }>) boards.set(f.prefix_id, [...(boards.get(f.prefix_id) ?? []), String(f.node_id)]);
      for (const r of rows as Array<{ prefix_id: number; css_class: string; phrase_text: string | null }>) {
        prefixes.push({ sourceId: String(r.prefix_id), label: r.phrase_text?.trim() || `Prefix ${r.prefix_id}`,
          tone: toneOfClass(r.css_class), nodeSourceIds: boards.get(r.prefix_id) });
      }
      const [tagged] = await conn.query(`SELECT thread_id, prefix_id FROM ${p}thread WHERE prefix_id > 0`);
      const byThread = new Map((tagged as Array<{ thread_id: number; prefix_id: number }>).map((r) => [String(r.thread_id), String(r.prefix_id)]));
      for (const th of threads) th.prefixSourceId = byThread.get(th.sourceId);
    } catch { reporter.warn("No thread prefix tables found: thread prefixes are not carried over."); }

    // Posts, likes and messages in pages: a big board doesn't fit in memory (batches.ts).
    const open = () => mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
    const close = (c: mysql.Connection) => c.end();
    const posts = keyset({
      total: await total(conn, `SELECT COUNT(*) n FROM ${p}post`),
      connect: open, close,
      fetch: async (c, after, limit) => (await c.query(
        `SELECT post_id, thread_id, user_id, post_date, last_edit_date, message, message_state
         FROM ${p}post WHERE post_id > ? ORDER BY post_id LIMIT ?`, [after, limit]))[0] as XfPostRow[],
      key: (row) => row.post_id,
      map: (rows) => rows.flatMap((row) => {
        if (row.message_state === "visible") return [mapPost(row)];
        skipped.push({ entity: "post", sourceId: String(row.post_id), reason: `state "${row.message_state}"` });
        return [];
      }),
    });

    // ── social graph: reactions → likes, follows, ignores → blocks ─────────
    // XF 2.1+ stores reactions in xf_reaction_content (all reaction types
    // collapse to a Xentium like — lossy, declared in inspect warnings);
    // XF 2.0 used xf_liked_content. Missing tables are skipped gracefully.
    let postLikes: Rows<ImportedPostLike> = [];
    type LikeRow = { id: number; content_id: number; user_id: number; at: number };
    const likesFrom = (table: string, id: string, user: string, date: string, n: number) => keyset({
      total: n, connect: open, close,
      fetch: async (c, after, limit) => (await c.query(
        `SELECT ${id} AS id, content_id, ${user} AS user_id, ${date} AS at FROM ${p}${table}
          WHERE content_type = 'post' AND ${id} > ? ORDER BY ${id} LIMIT ?`, [after, limit]))[0] as LikeRow[],
      key: (r) => r.id,
      map: (rows) => rows.map((r) => ({ postSourceId: String(r.content_id), userSourceId: String(r.user_id), createdAt: new Date(r.at * 1000) })),
    });
    try {
      const n = await total(conn, `SELECT COUNT(*) n FROM ${p}reaction_content WHERE content_type = 'post'`);
      postLikes = likesFrom("reaction_content", "reaction_content_id", "reaction_user_id", "reaction_date", n);
    } catch {
      try {
        const n = await total(conn, `SELECT COUNT(*) n FROM ${p}liked_content WHERE content_type = 'post'`);
        postLikes = likesFrom("liked_content", "like_id", "like_user_id", "like_date", n);
      } catch { reporter.warn("No reaction/like tables found — skipping post likes."); }
    }

    const follows: Array<{ followerSourceId: string; followingSourceId: string; createdAt?: Date }> = [];
    try {
      const [rows] = await conn.query(
        `SELECT user_id, follow_user_id, follow_date FROM ${p}user_follow`,
      );
      for (const r of rows as Array<{ user_id: number; follow_user_id: number; follow_date: number }>) {
        follows.push({
          followerSourceId: String(r.user_id),
          followingSourceId: String(r.follow_user_id),
          createdAt: new Date(r.follow_date * 1000),
        });
      }
    } catch { reporter.warn("No xf_user_follow table found — skipping follows."); }

    const blocks: Array<{ blockerSourceId: string; blockedSourceId: string }> = [];
    try {
      const [rows] = await conn.query(`SELECT user_id, ignored_user_id FROM ${p}user_ignored`);
      for (const r of rows as Array<{ user_id: number; ignored_user_id: number }>) {
        blocks.push({ blockerSourceId: String(r.user_id), blockedSourceId: String(r.ignored_user_id) });
      }
    } catch { reporter.warn("No xf_user_ignored table found — skipping ignores."); }

    // ── avatars: data/avatars/<size>/<id / 1000>/<id>.jpg; the largest size wins.
    try {
      const [rows] = await conn.query(`SELECT user_id FROM ${p}user WHERE avatar_date > 0`);
      const withAvatar = (rows as Array<{ user_id: number }>).map((r) => r.user_id);
      if (withAvatar.length && !source.filesDir) {
        reporter.warn(`${withAvatar.length} avatar(s) are files: pass --files <XenForo folder> to bring them over.`);
      } else {
        for (const id of withAvatar) {
          const file = ["o", "h", "l", "m"].map((size) => path.join(source.filesDir!, "data", "avatars", size, String(Math.floor(id / 1000)), `${id}.jpg`))
            .find((f) => fs.existsSync(f));
          const u = users.find((x) => x.sourceId === String(id));
          if (u && file) u.avatar = { path: file };
        }
      }
    } catch { /* no avatar_date column */ }

    // ── tags, thread watches, bans, profile posts ───────────────────────────
    const threadIds = new Set(threads.map((t) => t.sourceId));
    try {
      const [rows] = await conn.query(
        `SELECT tc.content_id, t.tag FROM ${p}tag_content tc JOIN ${p}tag t ON t.tag_id = tc.tag_id
          WHERE tc.content_type = 'thread' AND tc.visible = 1`);
      const byThread = new Map<string, string[]>();
      for (const r of rows as Array<{ content_id: number; tag: string }>) {
        const id = String(r.content_id);
        byThread.set(id, [...(byThread.get(id) ?? []), r.tag]);
      }
      for (const t of threads) t.tags = byThread.get(t.sourceId);
    } catch { reporter.warn("No tag tables found: thread tags are not carried over."); }

    const subscriptions: ImportedSubscription[] = [];
    try {
      const [rows] = await conn.query(`SELECT user_id, thread_id FROM ${p}thread_watch`);
      for (const r of rows as Array<{ user_id: number; thread_id: number }>) {
        if (threadIds.has(String(r.thread_id))) subscriptions.push({ userSourceId: String(r.user_id), threadSourceId: String(r.thread_id) });
      }
    } catch { reporter.warn("No xf_thread_watch table found: thread subscriptions are not carried over."); }

    const bans: ImportedBan[] = [];
    try {
      const [rows] = await conn.query(`SELECT user_id, ban_user_id, ban_date, end_date, user_reason FROM ${p}user_ban`);
      for (const r of rows as Array<{ user_id: number; ban_user_id: number; ban_date: number; end_date: number; user_reason: string }>) {
        bans.push({
          userSourceId: String(r.user_id), issuedBySourceId: r.ban_user_id ? String(r.ban_user_id) : undefined,
          reason: r.user_reason || "", expiresAt: r.end_date ? new Date(r.end_date * 1000) : null, createdAt: new Date(r.ban_date * 1000),
        });
      }
    } catch { reporter.warn("No xf_user_ban table found: bans are not carried over."); }

    // Warnings still in force: not expired, and no expiry date or one in the future.
    const warnings: ImportedWarning[] = [];
    try {
      const [rows] = await conn.query(
        `SELECT user_id, warning_user_id, warning_date, title, expiry_date FROM ${p}warning
          WHERE is_expired = 0 AND (expiry_date = 0 OR expiry_date > UNIX_TIMESTAMP())`);
      for (const r of rows as Array<{ user_id: number; warning_user_id: number; warning_date: number; title: string; expiry_date: number }>) {
        warnings.push({ userSourceId: String(r.user_id), issuedBySourceId: r.warning_user_id ? String(r.warning_user_id) : undefined,
          reason: r.title ?? "", expiresAt: r.expiry_date ? new Date(r.expiry_date * 1000) : null, createdAt: new Date(r.warning_date * 1000) });
      }
    } catch { reporter.warn("No xf_warning table found: warnings are not carried over."); }

    const profileComments: ImportedProfileComment[] = [];
    try {
      const [postsRows] = await conn.query(
        `SELECT profile_post_id, profile_user_id, user_id, post_date, message FROM ${p}profile_post WHERE message_state = 'visible'`);
      for (const r of postsRows as Array<{ profile_post_id: number; profile_user_id: number; user_id: number; post_date: number; message: string }>) {
        profileComments.push({ sourceId: `p${r.profile_post_id}`, profileUserSourceId: String(r.profile_user_id), authorSourceId: String(r.user_id),
          bodyHtml: xfBbcodeToHtml(r.message), createdAt: new Date(r.post_date * 1000) });
      }
      const owners = new Map(profileComments.map((c) => [c.sourceId, c.profileUserSourceId]));
      const [commentRows] = await conn.query(
        `SELECT profile_post_comment_id, profile_post_id, user_id, comment_date, message FROM ${p}profile_post_comment WHERE message_state = 'visible'`);
      for (const r of commentRows as Array<{ profile_post_comment_id: number; profile_post_id: number; user_id: number; comment_date: number; message: string }>) {
        const owner = owners.get(`p${r.profile_post_id}`);
        if (!owner) continue;
        profileComments.push({ sourceId: `c${r.profile_post_comment_id}`, profileUserSourceId: owner, authorSourceId: String(r.user_id),
          parentSourceId: `p${r.profile_post_id}`, bodyHtml: xfBbcodeToHtml(r.message), createdAt: new Date(r.comment_date * 1000) });
      }
    } catch { reporter.warn("No profile post tables found: profile walls are not carried over."); }

    // ── conversations → private conversations. recipient_state: 'active', or
    //    'deleted' / 'deleted_ignored' when that member removed it from their list.
    const conversations: ImportedConversation[] = [];
    let messages: Rows<ImportedMessage> = [];
    try {
      const [masters] = await conn.query(
        `SELECT conversation_id, title, user_id, start_date FROM ${p}conversation_master`);
      const [recipients] = await conn.query(
        `SELECT conversation_id, user_id, recipient_state FROM ${p}conversation_recipient`);
      const people = new Map<number, ImportedConversation["participants"]>();
      for (const r of recipients as Array<{ conversation_id: number; user_id: number; recipient_state: string }>) {
        people.set(r.conversation_id, [...(people.get(r.conversation_id) ?? []),
          { userSourceId: String(r.user_id), archived: r.recipient_state !== "active" }]);
      }
      for (const c of masters as Array<{ conversation_id: number; title: string; user_id: number; start_date: number }>) {
        conversations.push({
          sourceId: String(c.conversation_id),
          starterSourceId: String(c.user_id),
          title: c.title,
          participants: people.get(c.conversation_id) ?? [],
          createdAt: new Date(c.start_date * 1000),
        });
      }
      messages = keyset({
        total: await total(conn, `SELECT COUNT(*) n FROM ${p}conversation_message`),
        connect: open, close,
        fetch: async (c, after, limit) => (await c.query(
          `SELECT message_id, conversation_id, user_id, message_date, message FROM ${p}conversation_message
            WHERE message_id > ? ORDER BY message_id LIMIT ?`, [after, limit]))[0] as Array<{
            message_id: number; conversation_id: number; user_id: number; message_date: number; message: string }>,
        key: (m) => m.message_id,
        map: (rows) => rows.map((m) => ({
          sourceId: String(m.message_id),
          conversationSourceId: String(m.conversation_id),
          senderSourceId: String(m.user_id),
          bodyHtml: xfBbcodeToHtml(m.message),
          createdAt: new Date(m.message_date * 1000),
        })),
      });
    } catch { reporter.warn("No conversation tables found: skipping private conversations."); }

    return {
      sourceInfo: `XenForo ${version}`,
      groups,
      prefixes,
      subscriptions,
      bans,
      warnings,
      profileComments,
      conversations,
      messages,
      users,
      categories: [],
      articles: [],
      comments: [],
      forumNodes,
      threads,
      posts,
      postLikes,
      follows,
      blocks,
      skipped,
    };
  } finally {
    await conn.end();
  }
}
