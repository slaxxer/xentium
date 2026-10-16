import type { Rows } from "./batches.js";
import type { RedirectSpec } from "./redirects.js";
/**
 * The §34 adapter contract, two-stage:
 *
 *   source platform ──(adapter.extract)──▶ intermediate model ──(core loader)──▶ Xentium DB
 *
 * Adapters only know their source format (a WXR file, a MySQL schema, …) and
 * produce the platform-neutral intermediate model below. All Xentium knowledge
 * (tables, slugs, dedupe, import_map resumability, counters) lives in the
 * loader — so the heavy lifting is written and tested once, platform-free.
 */

// ── Intermediate model ───────────────────────────────────────────────────────

export interface ImportedUser {
  sourceId: string;
  email: string;
  username: string;
  /** Original hash from the source platform. Omitted (e.g. WXR file exports
   *  carry no hashes) → the account is created with an unusable password and
   *  the user goes through "forgot password" once. */
  passwordHash?: string;
  /** How to verify `passwordHash` on first login (core rehashes to argon2). */
  passwordScheme?: "bcrypt" | "phpass" | "vb-md5salt" | "vb-bcrypt-md5" | "wcf-double-bcrypt" | "wcf1";
  displayName?: string;
  bio?: string;
  /** Personal info from the profile: date of birth as YYYY-MM-DD (only full dates). */
  birthday?: string;
  /** Personal website (http/https only; anything else is dropped). */
  website?: string;
  /** The member's avatar: the image bytes (some boards keep them in the database) or
   *  the absolute path of the file on the old site. Checked and copied by the loader. */
  avatar?: { data?: Buffer; path?: string };
  /** Best-effort role mapping (§34): lossy by design, documented in the report. */
  role?: "admin" | "moderator" | "member";
  /** The member's other groups on the old site (ImportedGroup.sourceId), beyond staff and the defaults. */
  groupSourceIds?: string[];
  joinedAt?: Date;
  /** Their last visit on the old site, shown as "Last seen" until they come back. */
  lastSeenAt?: Date;
}

/**
 * A member group from the old site that isn't staff or a built-in one ("VIP",
 * "Donors", "Beta testers"). Recreated by name with NO permissions: what a group may
 * do differs too much between platforms to carry over, and an admin grants it in
 * ACP → Users → Groups.
 */
export interface ImportedGroup {
  sourceId: string;
  name: string;
}

export interface ImportedCategory {
  sourceId: string;
  name: string;
  description?: string;
  parentSourceId?: string;
}

export interface ImportedArticle {
  sourceId: string;
  authorSourceId: string;
  categorySourceId?: string;
  title: string;
  /** Source HTML — the loader converts to TipTap JSON (never stored raw, §17b). */
  contentHtml: string;
  excerpt?: string;
  status: "published" | "draft";
  publishedAt?: Date;
  createdAt?: Date;
  tags?: string[];
}

export interface ImportedComment {
  sourceId: string;
  articleSourceId: string;
  authorSourceId: string;
  /** Plain text (article comments are plain text in Xentium, §33). */
  bodyText: string;
  parentSourceId?: string;
  createdAt?: Date;
}

// ── Forum entities (loaded only when the xentium-forum plugin is enabled on
//    the target — adapters that produce these must declare it in
//    `requiredPlugins`; the run aborts cleanly otherwise) ───────────────────

export interface ImportedForumNode {
  sourceId: string;
  parentSourceId?: string;
  /** §39 node tree: categories hold no threads, forums do. */
  type: "category" | "forum";
  name: string;
  description?: string;
  /** Sort order within the parent (source display order). */
  position?: number;
}

export interface ImportedThread {
  sourceId: string;
  nodeSourceId: string;
  authorSourceId: string;
  title: string;
  status?: "open" | "locked";
  isPinned?: boolean;
  viewCount?: number;
  createdAt?: Date;
  /** Thread tags (trimmed, at most 10, each at most 40 characters). */
  tags?: string[];
  /** The thread's prefix on the old board (ImportedPrefix.sourceId). */
  prefixSourceId?: string;
}

/**
 * A thread prefix (XenForo), label (WoltLab) or prefix (vBulletin). Becomes a forum
 * prefix: the label, the nearest of the forum's colour tones, and the boards it was
 * offered in (none = every board).
 */
export interface ImportedPrefix {
  sourceId: string;
  label: string;
  tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  nodeSourceIds?: string[];
}

/** The nearest forum tone for an old platform's CSS class ("label--green", "badge red"…). */
export function toneOfClass(css: string | null | undefined): ImportedPrefix["tone"] {
  const c = (css ?? "").toLowerCase();
  if (/red|danger|error|important/.test(c)) return "danger";
  if (/green|success/.test(c)) return "success";
  if (/orange|yellow|amber|warning|olive/.test(c)) return "warning";
  if (/blue|sky|info|lightblue|cyan|royal/.test(c)) return "info";
  if (/primary|accent|purple|violet|pink/.test(c)) return "accent";
  return "neutral";
}

export interface ImportedPost {
  sourceId: string;
  threadSourceId: string;
  authorSourceId: string;
  /** Safe HTML (forum posts store sanitized HTML). Adapters convert their
   *  source markup (BBCode, s9e XML, …) and must escape all text content. */
  bodyHtml: string;
  createdAt?: Date;
  editedAt?: Date;
}

// ── Social graph (likes / follows / blocks — §36/§45) ───────────────────────

export interface ImportedPostLike {
  postSourceId: string;
  userSourceId: string;
  createdAt?: Date;
}

export interface ImportedFollow {
  followerSourceId: string;
  followingSourceId: string;
  createdAt?: Date;
}

export interface ImportedBlock {
  blockerSourceId: string;
  blockedSourceId: string;
  createdAt?: Date;
}

/** A member following a thread. Only threads that were imported count. */
export interface ImportedSubscription {
  userSourceId: string;
  threadSourceId: string;
  createdAt?: Date;
}

/** A ban that is still in force. Expired and lifted bans are not imported. */
export interface ImportedBan {
  userSourceId: string;
  /** Who issued it; falls back to the first administrator when they weren't imported. */
  issuedBySourceId?: string;
  reason: string;
  /** null = permanent. */
  expiresAt: Date | null;
  createdAt?: Date;
}

/** A warning still in force. Expired, reversed and pardoned warnings are not imported. */
export interface ImportedWarning {
  userSourceId: string;
  /** Who issued it; falls back to the first administrator when they weren't imported. */
  issuedBySourceId?: string;
  reason: string;
  /** null = never expires. */
  expiresAt: Date | null;
  createdAt?: Date;
}

/** A post on a member's profile wall, or a reply to one (one level deep). */
export interface ImportedProfileComment {
  sourceId: string;
  profileUserSourceId: string;
  authorSourceId: string;
  bodyHtml: string;
  parentSourceId?: string;
  createdAt?: Date;
}

// ── Private conversations (loaded only when the xentium-messaging plugin is
//    enabled on the target; otherwise counted and reported as skipped) ────────

export interface ImportedConversationParticipant {
  userSourceId: string;
  /** Left the conversation on the old site: kept as a participant who has left. */
  left?: boolean;
  /** Deleted or hid it on the old site: arrives archived, not back in the inbox. */
  archived?: boolean;
}

export interface ImportedConversation {
  sourceId: string;
  starterSourceId: string;
  title?: string;
  participants: ImportedConversationParticipant[];
  createdAt?: Date;
}

export interface ImportedMessage {
  sourceId: string;
  conversationSourceId: string;
  senderSourceId: string;
  /** Safe HTML, like forum posts (the loader sanitizes it once more). */
  bodyHtml: string;
  createdAt?: Date;
}

export interface ExtractResult {
  /** Human-readable source description, e.g. "WordPress (WXR 1.2)". */
  sourceInfo: string;
  users: ImportedUser[];
  /** Member groups beyond staff and the defaults. Loaded before the users who are in them. */
  groups?: ImportedGroup[];
  categories: ImportedCategory[];
  articles: ImportedArticle[];
  comments: ImportedComment[];
  forumNodes?: ImportedForumNode[];
  threads?: ImportedThread[];
  /** Thread prefixes / labels. Loaded after the boards, before the threads. */
  prefixes?: ImportedPrefix[];
  /** Posts, likes and messages may come in pages (batches.ts): a big board doesn't fit in memory. */
  posts?: Rows<ImportedPost>;
  /** Post likes/reactions (multi-type reactions collapse to a like — lossy). */
  postLikes?: Rows<ImportedPostLike>;
  follows?: ImportedFollow[];
  blocks?: ImportedBlock[];
  subscriptions?: ImportedSubscription[];
  bans?: ImportedBan[];
  warnings?: ImportedWarning[];
  profileComments?: ImportedProfileComment[];
  conversations?: ImportedConversation[];
  messages?: Rows<ImportedMessage>;
  /** Extractor-level skips (pages, attachments, guest comments, …). */
  skipped: ImportError[];
}

// ── Adapter contract (§34) ───────────────────────────────────────────────────

export interface AdapterSource {
  /** File-based sources (e.g. a WXR export). */
  file?: string;
  /** Connection string for direct-DB sources (e.g. mysql://… for phpBB). */
  db?: string;
  /** Source table prefix for DB sources (e.g. "phpbb_"). */
  tablePrefix?: string;
  /** The old site's folder on this machine (its install or upload directory), for files
   *  such as avatars. Without it, file-based avatars are left out and reported. */
  filesDir?: string;
}

export interface MigrationInspection {
  platform: string; // e.g. "WordPress (WXR 1.2)"
  counts: Record<string, number>;
  warnings: string[];
  preconditions: { met: string[]; missing: string[] };
}

export interface MigrateAdapter {
  /** Adapter id — also the import_map `platform` key. e.g. "wordpress". */
  name: string;
  version: string;
  /** Plugins that must be installed AND enabled on the target Xentium instance
   *  (§34 preconditions) — e.g. ["xentium-forum"] for forum-platform adapters.
   *  The run aborts before touching any data when one is missing: importing a
   *  forum board without the forum plugin would strand users with no content. */
  requiredPlugins?: string[];
  inspect(source: AdapterSource): Promise<MigrationInspection>;
  extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult>;
  /** How the old platform's addresses name a thread, post, board, member or article,
   *  for `--redirects` (see redirects.ts). May read the source for addresses with no id. */
  redirects?(source: AdapterSource): Promise<RedirectSpec>;
}

// ── Reporting ────────────────────────────────────────────────────────────────

export interface ImportError {
  entity: string;
  sourceId: string;
  reason: string;
}

export interface MigrationReporter {
  info(message: string): void;
  warn(message: string): void;
  progress(entity: string, done: number, total: number): void;
}

export interface MigrationSummary {
  /** Entity → imported count (skipped/mapped-to-existing not included). */
  counts: Record<string, number>;
  errors: ImportError[];
  durationMs: number;
}

/** Sets each user's `lastSeenAt` from (source id, unix seconds) rows; 0 / missing = never. */
export function attachLastSeen(users: ImportedUser[], rows: Array<{ id: number | string; at: number | null }>): void {
  const byId = new Map(rows.filter((r) => Number(r.at) > 0).map((r) => [String(r.id), new Date(Number(r.at) * 1000)]));
  for (const u of users) { const at = byId.get(u.sourceId); if (at) u.lastSeenAt = at; }
}

/** A full date of birth as YYYY-MM-DD, or undefined when a part is missing (no year = no import). */
export function birthdayOf(year: number | null | undefined, month: number | null | undefined, day: number | null | undefined): string | undefined {
  if (!year || !month || !day || year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDate() === day && d.getTime() < Date.now() ? iso : undefined;
}
