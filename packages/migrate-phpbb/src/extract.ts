import mysql from "mysql2/promise";
import type { ExtractResult, ImportError, MigrationReporter } from "@nodevo/migrate-core";
import {
  mapForum, mapPost, mapTopic, mapUser, USER_TYPE_BOT,
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

    const users = [];
    for (const row of userRows as PhpbbUserRow[]) {
      const user = mapUser(row, roleByUser.get(row.user_id));
      if (user) users.push(user);
      else skipped.push({ entity: "user", sourceId: String(row.user_id), reason: "missing email or username" });
    }

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

    const [postRows] = await conn.query(
      `SELECT post_id, topic_id, poster_id, post_time, post_edit_time,
              post_text, bbcode_uid, post_visibility
       FROM ${p}posts ORDER BY post_time`,
    );
    const posts = [];
    for (const row of postRows as PhpbbPostRow[]) {
      if (row.post_visibility !== 1) {
        skipped.push({ entity: "post", sourceId: String(row.post_id), reason: "not approved/visible" });
        continue;
      }
      posts.push(mapPost(row));
    }

    return {
      sourceInfo: `phpBB ${version}`,
      users,
      categories: [],
      articles: [],
      comments: [],
      forumNodes,
      threads,
      posts,
      skipped,
    };
  } finally {
    await conn.end();
  }
}
