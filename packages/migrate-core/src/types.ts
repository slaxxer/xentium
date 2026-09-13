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
  passwordScheme?: "bcrypt" | "phpass";
  displayName?: string;
  bio?: string;
  /** Best-effort role mapping (§34): lossy by design, documented in the report. */
  role?: "admin" | "moderator" | "member";
  joinedAt?: Date;
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

export interface ExtractResult {
  /** Human-readable source description, e.g. "WordPress (WXR 1.2)". */
  sourceInfo: string;
  users: ImportedUser[];
  categories: ImportedCategory[];
  articles: ImportedArticle[];
  comments: ImportedComment[];
  forumNodes?: ImportedForumNode[];
  threads?: ImportedThread[];
  posts?: ImportedPost[];
  /** Post likes/reactions (multi-type reactions collapse to a like — lossy). */
  postLikes?: ImportedPostLike[];
  follows?: ImportedFollow[];
  blocks?: ImportedBlock[];
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
