import mysql from "mysql2/promise";
import type { ExtractResult, ImportError, MigrationReporter } from "@nodevo/migrate-core";
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
    const users = [];
    for (const row of userRows as XfUserRow[]) {
      const user = mapUser(row);
      if (user) users.push(user);
      else skipped.push({ entity: "user", sourceId: String(row.user_id), reason: "missing email or username" });
    }

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

    const [postRows] = await conn.query(
      `SELECT post_id, thread_id, user_id, post_date, last_edit_date, message, message_state
       FROM ${p}post ORDER BY post_date`,
    );
    const posts = [];
    for (const row of postRows as XfPostRow[]) {
      if (row.message_state !== "visible") {
        skipped.push({ entity: "post", sourceId: String(row.post_id), reason: `state "${row.message_state}"` });
        continue;
      }
      posts.push(mapPost(row));
    }

    return {
      sourceInfo: `XenForo ${version}`,
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
