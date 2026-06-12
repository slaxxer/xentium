/**
 * The §34 adapter contract, two-stage:
 *
 *   source platform ──(adapter.extract)──▶ intermediate model ──(core loader)──▶ Nodevo DB
 *
 * Adapters only know their source format (a WXR file, a MySQL schema, …) and
 * produce the platform-neutral intermediate model below. All Nodevo knowledge
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
  /** Plain text (article comments are plain text in Nodevo, §33). */
  bodyText: string;
  parentSourceId?: string;
  createdAt?: Date;
}

export interface ExtractResult {
  /** Human-readable source description, e.g. "WordPress (WXR 1.2)". */
  sourceInfo: string;
  users: ImportedUser[];
  categories: ImportedCategory[];
  articles: ImportedArticle[];
  comments: ImportedComment[];
  /** Extractor-level skips (pages, attachments, guest comments, …). */
  skipped: ImportError[];
}

// ── Adapter contract (§34) ───────────────────────────────────────────────────

export interface AdapterSource {
  /** File-based sources (e.g. a WXR export). */
  file?: string;
  /** Connection string for direct-DB sources (e.g. mysql://… for phpBB). */
  db?: string;
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
