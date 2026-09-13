import type {
  ImportedForumNode, ImportedPost, ImportedThread, ImportedUser,
} from "@xentium/migrate-core";
import { extractBcryptHash, xfBbcodeToHtml } from "./bbcode.js";

/** Pure row → intermediate-model mapping (unit-tested without MySQL). */

export interface XfUserRow {
  user_id: number;
  username: string;
  email: string;
  register_date: number; // unix
  user_state: string;    // 'valid' | 'email_confirm' | …
  is_admin: number;
  is_moderator: number;
  scheme_class: string | null;  // joined from xf_user_authenticate
  auth_data: string | Buffer | null;
}

export function mapUser(row: XfUserRow): ImportedUser | null {
  if (!row.email || !row.username) return null;
  const hash = row.scheme_class && row.auth_data != null
    ? extractBcryptHash(row.scheme_class, row.auth_data)
    : null;
  return {
    sourceId: String(row.user_id),
    email: row.email,
    username: row.username,
    passwordHash: hash ?? undefined,
    passwordScheme: hash ? "bcrypt" : undefined,
    role: row.is_admin ? "admin" : row.is_moderator ? "moderator" : undefined,
    joinedAt: row.register_date ? new Date(row.register_date * 1000) : undefined,
  };
}

export interface XfNodeRow {
  node_id: number;
  parent_node_id: number;
  title: string;
  description: string;
  node_type_id: string; // 'Category' | 'Forum' | 'LinkForum' | 'Page' | …
  display_order: number;
}

export function mapNode(row: XfNodeRow): ImportedForumNode | null {
  if (row.node_type_id !== "Category" && row.node_type_id !== "Forum") return null;
  return {
    sourceId: String(row.node_id),
    parentSourceId: row.parent_node_id ? String(row.parent_node_id) : undefined,
    type: row.node_type_id === "Category" ? "category" : "forum",
    name: row.title,
    description: row.description || undefined,
    position: row.display_order,
  };
}

export interface XfThreadRow {
  thread_id: number;
  node_id: number;
  title: string;
  user_id: number;
  post_date: number;
  discussion_state: string; // 'visible' | 'moderated' | 'deleted'
  discussion_open: number;
  sticky: number;
  view_count: number;
}

export function mapThread(row: XfThreadRow): ImportedThread {
  return {
    sourceId: String(row.thread_id),
    nodeSourceId: String(row.node_id),
    authorSourceId: String(row.user_id),
    title: row.title,
    status: row.discussion_open ? "open" : "locked",
    isPinned: row.sticky === 1,
    viewCount: row.view_count,
    createdAt: new Date(row.post_date * 1000),
  };
}

export interface XfPostRow {
  post_id: number;
  thread_id: number;
  user_id: number;
  post_date: number;
  last_edit_date: number;
  message: string;
  message_state: string; // 'visible' | 'moderated' | 'deleted'
}

export function mapPost(row: XfPostRow): ImportedPost {
  return {
    sourceId: String(row.post_id),
    threadSourceId: String(row.thread_id),
    authorSourceId: String(row.user_id),
    bodyHtml: xfBbcodeToHtml(row.message),
    createdAt: new Date(row.post_date * 1000),
    editedAt: row.last_edit_date ? new Date(row.last_edit_date * 1000) : undefined,
  };
}

/** XenForo version_id (e.g. 2021370) → human "2.2.13". */
export function decodeVersionId(versionId: number): string {
  const major = Math.floor(versionId / 1000000);
  const minor = Math.floor(versionId / 10000) % 100;
  const patch = Math.floor(versionId / 100) % 100;
  return `${major}.${minor}.${patch}`;
}
