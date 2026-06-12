import type {
  ImportedForumNode, ImportedPost, ImportedThread, ImportedUser,
} from "@nodevo/migrate-core";
import { convertPostText } from "./postText.js";

/**
 * Pure row → intermediate-model mapping. No database access — this is the
 * layer the unit tests exercise with plain objects, so the extractor itself
 * stays a thin set of SELECTs.
 */

// phpBB user_type: 0 normal, 1 inactive, 2 ignore (bots/anonymous), 3 founder.
export const USER_TYPE_BOT = 2;
const USER_TYPE_FOUNDER = 3;

export interface PhpbbUserRow {
  user_id: number;
  username: string;
  user_email: string;
  user_password: string;
  user_regdate: number; // unix
  user_type: number;
}

export function mapUser(row: PhpbbUserRow, role: "admin" | "moderator" | undefined): ImportedUser | null {
  if (!row.user_email || !row.username) return null;
  const scheme = detectScheme(row.user_password);
  return {
    sourceId: String(row.user_id),
    email: row.user_email,
    username: row.username,
    // Unsupported hash formats (md5 from pre-3.0 imports, …) → no hash, the
    // user resets once. Supported ones keep working via core legacy login.
    passwordHash: scheme ? row.user_password : undefined,
    passwordScheme: scheme,
    role: row.user_type === USER_TYPE_FOUNDER ? "admin" : role,
    joinedAt: row.user_regdate ? new Date(row.user_regdate * 1000) : undefined,
  };
}

export function detectScheme(hash: string): "bcrypt" | "phpass" | undefined {
  if (/^\$2[aby]\$/.test(hash)) return "bcrypt";
  if (/^\$[PH]\$/.test(hash)) return "phpass";
  return undefined;
}

// phpBB forum_type: 0 category, 1 forum, 2 link.
export interface PhpbbForumRow {
  forum_id: number;
  parent_id: number;
  forum_name: string;
  forum_desc: string;
  forum_type: number;
  left_id: number;
}

export function mapForum(row: PhpbbForumRow, position: number): ImportedForumNode | null {
  if (row.forum_type === 2) return null; // external link "forums" have no content
  return {
    sourceId: String(row.forum_id),
    parentSourceId: row.parent_id ? String(row.parent_id) : undefined,
    type: row.forum_type === 0 ? "category" : "forum",
    name: row.forum_name,
    description: row.forum_desc || undefined,
    position,
  };
}

export interface PhpbbTopicRow {
  topic_id: number;
  forum_id: number;
  topic_title: string;
  topic_poster: number;
  topic_time: number;
  topic_status: number;     // 1 = locked
  topic_type: number;       // > 0 = sticky/announce/global
  topic_views: number;
  topic_visibility: number; // 1 = approved
}

export function mapTopic(row: PhpbbTopicRow): ImportedThread {
  return {
    sourceId: String(row.topic_id),
    nodeSourceId: String(row.forum_id),
    authorSourceId: String(row.topic_poster),
    title: row.topic_title,
    status: row.topic_status === 1 ? "locked" : "open",
    isPinned: row.topic_type > 0,
    viewCount: row.topic_views,
    createdAt: new Date(row.topic_time * 1000),
  };
}

export interface PhpbbPostRow {
  post_id: number;
  topic_id: number;
  poster_id: number;
  post_time: number;
  post_edit_time: number;
  post_text: string;
  bbcode_uid: string;
  post_visibility: number; // 1 = approved
}

export function mapPost(row: PhpbbPostRow): ImportedPost {
  return {
    sourceId: String(row.post_id),
    threadSourceId: String(row.topic_id),
    authorSourceId: String(row.poster_id),
    bodyHtml: convertPostText(row.post_text, row.bbcode_uid),
    createdAt: new Date(row.post_time * 1000),
    editedAt: row.post_edit_time ? new Date(row.post_edit_time * 1000) : undefined,
  };
}
