import type { ImportedForumNode, ImportedPost, ImportedThread, ImportedUser } from "@xentium/migrate-core";
import { unescapeVb, vbBbcodeToHtml } from "./bbcode.js";

/** Pure row → intermediate-model mapping for both vBulletin layouts (unit-tested without MySQL). */

// ── Users (same table in every version; the password columns differ) ─────────

/** vBulletin's stock group ids. Custom groups map to Member (lossy, reported). */
const ADMIN_GROUP = 6;
const MODERATOR_GROUPS = new Set([5, 7]); // Super Moderators, Moderators

export interface VbUserRow {
  userid: number;
  username: string;
  email: string;
  joindate: number; // unix
  usergroupid: number;
  membergroupids: string | null; // "5,9"
  // vB3/4
  password?: string | null;
  salt?: string | null;
  // vB5/6
  token?: string | null;
  scheme?: string | null;
  secret?: string | null;
}

/** vBulletin's stock groups are 1–8 (guests, registered, awaiting e-mail, COPPA, super
 *  moderators, administrators, moderators, banned); staff among them map to roles. */
export const LAST_STOCK_GROUP = 8;

function groupsOf(row: VbUserRow): number[] {
  const extra = (row.membergroupids ?? "").split(",").map((g) => Number(g.trim())).filter(Boolean);
  return [row.usergroupid, ...extra];
}

/** The account's password as Xentium can verify it, or nothing (the member resets once). */
export function passwordOf(row: VbUserRow): Pick<ImportedUser, "passwordHash" | "passwordScheme"> {
  // vB5/6: "blowfish:11" = bcrypt over md5(password); "legacy" = a vB4 hash carried over.
  if (row.scheme != null || row.token != null) {
    const token = row.token ?? "";
    if (/^blowfish/i.test(row.scheme ?? "") && /^\$2[aby]\$/.test(token)) {
      return { passwordHash: token, passwordScheme: "vb-bcrypt-md5" };
    }
    if (/^legacy/i.test(row.scheme ?? "") && /^[0-9a-f]{32}$/i.test(token) && row.secret != null) {
      return { passwordHash: `${token.toLowerCase()}:${row.secret}`, passwordScheme: "vb-md5salt" };
    }
    return {};
  }
  // vB3/4: md5(md5(password) . salt)
  if (row.password && /^[0-9a-f]{32}$/i.test(row.password) && row.salt != null) {
    return { passwordHash: `${row.password.toLowerCase()}:${row.salt}`, passwordScheme: "vb-md5salt" };
  }
  return {};
}

export function mapUser(row: VbUserRow): ImportedUser | null {
  if (!row.email || !row.username) return null;
  const groups = groupsOf(row);
  return {
    sourceId: String(row.userid),
    email: row.email,
    username: unescapeVb(row.username),
    ...passwordOf(row),
    role: groups.includes(ADMIN_GROUP) ? "admin" : groups.some((g) => MODERATOR_GROUPS.has(g)) ? "moderator" : undefined,
    // Groups past vBulletin's stock eight; the ones that come over (readGroups) are joined.
    groupSourceIds: groups.filter((g) => g > LAST_STOCK_GROUP).map(String),
    joinedAt: row.joindate ? new Date(row.joindate * 1000) : undefined,
  };
}

// ── vBulletin 3 and 4 ────────────────────────────────────────────────────────

/** forum.options bit: the forum can hold threads (otherwise it's a category). */
const CAN_CONTAIN_THREADS = 4;

export interface VbForumRow {
  forumid: number;
  parentid: number; // -1 = top level
  title: string;
  description: string | null;
  displayorder: number;
  options: number;
  link: string | null; // non-empty = a link forum
}

export function mapForum(row: VbForumRow): ImportedForumNode | null {
  if (row.link) return null;
  return {
    sourceId: String(row.forumid),
    parentSourceId: row.parentid > 0 ? String(row.parentid) : undefined,
    type: row.options & CAN_CONTAIN_THREADS ? "forum" : "category",
    name: unescapeVb(row.title),
    description: row.description ? unescapeVb(row.description) : undefined,
    position: row.displayorder,
  };
}

export interface VbThreadRow {
  threadid: number;
  forumid: number;
  title: string;
  postuserid: number;
  dateline: number;
  open: number;    // 1 open, 0 closed, 10 = a "moved" redirect
  sticky: number;
  views: number;
  visible: number; // 1 visible, 0 awaiting moderation, 2 deleted
}

/** Why a vB3/4 thread is left out, or null when it moves over. */
export function threadSkipReason(row: VbThreadRow): string | null {
  if (row.open === 10) return "moved-thread redirect";
  if (row.visible !== 1) return row.visible === 2 ? "deleted" : "awaiting moderation";
  if (!row.postuserid) return "started by a guest (no account to attach it to)";
  return null;
}

export function mapThread(row: VbThreadRow): ImportedThread {
  return {
    sourceId: String(row.threadid),
    nodeSourceId: String(row.forumid),
    authorSourceId: String(row.postuserid),
    title: unescapeVb(row.title),
    status: row.open ? "open" : "locked",
    isPinned: row.sticky === 1,
    viewCount: row.views,
    createdAt: new Date(row.dateline * 1000),
  };
}

export interface VbPostRow {
  postid: number;
  threadid: number;
  userid: number;
  dateline: number;
  pagetext: string;
  visible: number;
  edited: number | null; // latest editlog.dateline
}

export function postSkipReason(row: { visible: number; userid: number }): string | null {
  if (row.visible !== 1) return row.visible === 2 ? "deleted" : "awaiting moderation";
  if (!row.userid) return "written by a guest (no account to attach it to)";
  return null;
}

export function mapPost(row: VbPostRow): ImportedPost {
  return {
    sourceId: String(row.postid),
    threadSourceId: String(row.threadid),
    authorSourceId: String(row.userid),
    bodyHtml: vbBbcodeToHtml(row.pagetext ?? ""),
    createdAt: new Date(row.dateline * 1000),
    editedAt: row.edited ? new Date(row.edited * 1000) : undefined,
  };
}

// ── vBulletin 5 and 6 (everything is a node) ─────────────────────────────────

export interface VbChannelRow {
  nodeid: number;
  parentid: number;
  title: string;
  description: string | null;
  displayorder: number;
  category: number; // 1 = a category: holds channels, not topics
}

export function mapChannel(row: VbChannelRow, forumRootId: number): ImportedForumNode {
  return {
    sourceId: String(row.nodeid),
    parentSourceId: row.parentid !== forumRootId ? String(row.parentid) : undefined,
    type: row.category ? "category" : "forum",
    name: unescapeVb(row.title),
    description: row.description ? unescapeVb(row.description) : undefined,
    position: row.displayorder,
  };
}

export interface VbNodeRow {
  nodeid: number;
  parentid: number;
  starter: number;
  userid: number;
  title: string | null;
  publishdate: number;
  open: number;
  sticky: number;
  showpublished: number;
  showapproved: number;
  rawtext: string | null;
  edited: number | null;
  views: number | null;
}

/** Why a vB5/6 content node is left out, or null when it moves over. */
export function nodeSkipReason(row: VbNodeRow): string | null {
  if (!row.showpublished) return "unpublished or deleted";
  if (!row.showapproved) return "awaiting moderation";
  if (!row.userid) return "written by a guest (no account to attach it to)";
  if (row.rawtext == null) return "no text (a photo, poll or link without a body)";
  return null;
}

/** A topic starter is both the thread and its first post (same node id, different entities). */
export function mapTopic(row: VbNodeRow): ImportedThread {
  return {
    sourceId: String(row.nodeid),
    nodeSourceId: String(row.parentid),
    authorSourceId: String(row.userid),
    title: unescapeVb(row.title ?? "Untitled"),
    status: row.open ? "open" : "locked",
    isPinned: row.sticky === 1,
    viewCount: row.views ?? 0,
    createdAt: new Date(row.publishdate * 1000),
  };
}

export function mapNodePost(row: VbNodeRow): ImportedPost {
  return {
    sourceId: String(row.nodeid),
    threadSourceId: String(row.starter),
    authorSourceId: String(row.userid),
    bodyHtml: vbBbcodeToHtml(row.rawtext ?? ""),
    createdAt: new Date(row.publishdate * 1000),
    editedAt: row.edited ? new Date(row.edited * 1000) : undefined,
  };
}
