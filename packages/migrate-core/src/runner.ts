import crypto from "node:crypto";
import pg from "pg";
import { pagesOf, sizeOf, type Rows } from "./batches.js";
import { XentiumLoader, missingPlugins } from "./loader.js";
import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationReporter, MigrationSummary } from "./types.js";

export interface RunOptions {
  /** Target Xentium PostgreSQL connection string. */
  targetDb: string;
  /** Inspect + extract + report, write nothing (the safe community-beta mode). */
  dryRun?: boolean;
  /** How the run was started, connection strings masked — the ACP offers it
   *  back as the dry-run and re-run commands. Never pass a secret here. */
  command?: string;
  /** Xentium's upload folder, for avatars. */
  uploadsDir?: string;
}

/**
 * Orchestrates a full migration run: extract → load → migration_runs log row
 * (§34 — the ACP Migration History page reads these). Dry runs write nothing,
 * including the log row.
 *
 * The row is created BEFORE extraction and kept current while the run goes:
 * the log, per-entity progress and a heartbeat (see RunRecorder). An import of
 * a large forum takes many minutes, and the ACP shows it live rather than a
 * spinner that says nothing until the end.
 */
export async function runMigration(
  adapter: MigrateAdapter,
  source: AdapterSource,
  options: RunOptions,
  reporter: MigrationReporter,
): Promise<MigrationSummary> {
  const startedAt = new Date();
  const pool = new pg.Pool({ connectionString: options.targetDb, max: 5 });

  try {
    // Fail fast, before extraction: a forum-platform import without the forum
    // plugin would strand users with no content — refuse outright (§34).
    const missing = await missingPlugins(pool, adapter.requiredPlugins ?? []);
    if (missing.length) {
      throw new Error(
        `Required plugin(s) not enabled on the target: ${missing.join(", ")}. ` +
        `Install + enable them in ACP → Extensions first — nothing was touched.`,
      );
    }

    if (options.dryRun) {
      const extract = await adapter.extract(source, reporter);
      // A paged list reads every page once, so its skips are reported and its count is
      // real; nothing is kept, so a dry run of a huge board fits in memory too.
      const counted = async <T,>(rows: Rows<T> | undefined): Promise<number> => {
        let n = 0;
        for await (const page of pagesOf(rows)) n += page.length;
        return n;
      };
      reporter.info("Dry run — nothing was written. Counts below reflect what a real run would import.");
      const counts: Record<string, number> = {
        groups: extract.groups?.length ?? 0,
        users: extract.users.length,
        categories: extract.categories.length,
        articles: extract.articles.length,
        comments: extract.comments.length,
      };
      if (extract.forumNodes) counts.forumNodes = extract.forumNodes.length;
      if (extract.prefixes) counts.prefixes = extract.prefixes.length;
      if (extract.threads) counts.threads = extract.threads.length;
      if (extract.posts) counts.posts = await counted(extract.posts);
      if (extract.subscriptions) counts.subscriptions = extract.subscriptions.length;
      if (extract.bans) counts.bans = extract.bans.length;
      if (extract.warnings) counts.warnings = extract.warnings.length;
      if (extract.profileComments) counts.profileComments = extract.profileComments.length;
      if (extract.conversations) counts.conversations = extract.conversations.length;
      if (extract.messages) counts.messages = await counted(extract.messages);
      if (extract.postLikes) counts.postLikes = await counted(extract.postLikes);
      return {
        counts,
        errors: extract.skipped,
        durationMs: Date.now() - startedAt.getTime(),
      };
    }

    const runId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO xcf_migration_runs (id, adapter, adapter_ver, status, command, started_at)
       VALUES ($1, $2, $3, 'running', $4, $5)`,
      [runId, adapter.name, adapter.version, options.command ?? null, startedAt],
    );

    const recorder = new RunRecorder(pool, runId, reporter);
    recorder.line(`${adapter.name} adapter v${adapter.version}`);
    recorder.start();

    let extract: ExtractResult;
    let loader: XentiumLoader;
    try {
      extract = await adapter.extract(source, recorder);
      recorder.line(`Source: ${extract.sourceInfo}`);
      recorder.plan(extract);
      await pool.query(`UPDATE xcf_migration_runs SET source_info = $2 WHERE id = $1`, [runId, extract.sourceInfo]);

      loader = new XentiumLoader(pool, adapter.name, runId, recorder);
      loader.uploadsDir = options.uploadsDir ?? null;
      await loader.loadAll(extract, adapter.requiredPlugins ?? []);
    } catch (err) {
      // Hard failure (lost DB, bad source, …): the log row must not stay
      // "running" forever — mark it failed, with the log so far, before rethrowing.
      recorder.line(`error: ${(err as Error).message}`);
      await recorder.stop();
      await pool.query(
        `UPDATE xcf_migration_runs
         SET status = 'failed', completed_at = NOW(), "durationMs" = $2, errors = $3, output = $4, progress = $5
         WHERE id = $1`,
        [runId, Date.now() - startedAt.getTime(),
          JSON.stringify([{ entity: "run", sourceId: "-", reason: (err as Error).message }]),
          recorder.output(), JSON.stringify(recorder.snapshot())],
      ).catch(() => { /* connection may be gone */ });
      throw err;
    }

    const errors = [...extract.skipped, ...loader.errors];
    const durationMs = Date.now() - startedAt.getTime();
    const status = errors.length ? "partial" : "completed";
    recorder.line(`Done in ${formatDuration(durationMs)} — ${errors.length ? `${errors.length} issues` : "no issues"}.`);
    await recorder.stop();
    await pool.query(
      `UPDATE xcf_migration_runs
       SET status = $2, completed_at = NOW(), "durationMs" = $3, summary = $4, errors = $5, output = $6, progress = $7
       WHERE id = $1`,
      [runId, status, durationMs, JSON.stringify(loader.counts), JSON.stringify(errors.slice(0, 500)),
        recorder.output(), JSON.stringify(recorder.snapshot())],
    );

    return { counts: loader.counts, errors, durationMs };
  } finally {
    await pool.end();
  }
}

/** What each entity is called in the log. Keys match the loader's counts. */
const ENTITY_WORDS: Record<string, string> = {
  groups: "member groups", users: "users", categories: "categories", articles: "articles", comments: "comments",
  forumNodes: "forum nodes", prefixes: "thread prefixes", threads: "threads", posts: "posts",
  blocks: "blocks", follows: "follows", postLikes: "likes",
};

/** The order the loader works through them (loader.loadAll). */
const LOAD_ORDER = ["groups", "users", "categories", "articles", "comments", "forumNodes", "prefixes", "threads", "posts", "blocks", "follows", "postLikes"] as const;

/** A heartbeat older than the ACP's threshold (2 min) reads as a dead run. */
const HEARTBEAT_MS = 5_000;
const FLUSH_MS = 1_000;
/** A big import's log is capped: its head (what ran) and its tail (how it ended). */
const OUTPUT_CAP = 64 * 1024;

export interface RunProgress {
  /** Heartbeat, ISO time of the last write. */
  at: string;
  /** The entity being loaded right now, or null outside the load phase. */
  current: string | null;
  entities: Record<string, { done: number; total: number }>;
}

/**
 * A MigrationReporter that also keeps the run's row current.
 *
 * Every message still reaches the terminal (it wraps the CLI's reporter); the
 * log lines, the per-entity counts and a heartbeat are written to the row at
 * most once a second while something changed, and every five seconds
 * regardless — a long recount prints nothing, and must not look dead.
 */
class RunRecorder implements MigrationReporter {
  private readonly lines: string[] = [];
  private readonly entities: RunProgress["entities"] = {};
  private current: string | null = null;
  private dirty = true;
  private lastWrite = 0;
  private writing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly runId: string,
    private readonly inner: MigrationReporter,
  ) {}

  info(message: string): void {
    this.inner.info(message);
    this.line(message);
  }

  warn(message: string): void {
    this.inner.warn(message);
    this.line(`warn: ${message}`);
  }

  progress(entity: string, done: number, total: number): void {
    this.inner.progress(entity, done, total);
    this.current = done >= total ? null : entity;
    this.entities[entity] = { done, total };
    if (done >= total) {
      const n = total.toLocaleString("en-US");
      this.line(`Loading ${ENTITY_WORDS[entity] ?? entity}… ${n}/${n} ✔`);
    }
    this.dirty = true;
  }

  line(text: string): void {
    this.lines.push(text);
    this.dirty = true;
  }

  /** Every entity this run will load, at zero, so the ACP shows the whole plan. */
  plan(extract: ExtractResult): void {
    const sizes: Record<string, number> = {
      groups: extract.groups?.length ?? 0, users: extract.users.length, categories: extract.categories.length,
      articles: extract.articles.length, comments: extract.comments.length,
      forumNodes: extract.forumNodes?.length ?? 0, prefixes: extract.prefixes?.length ?? 0, threads: extract.threads?.length ?? 0,
      posts: sizeOf(extract.posts), blocks: extract.blocks?.length ?? 0,
      follows: extract.follows?.length ?? 0, postLikes: sizeOf(extract.postLikes),
    };
    for (const key of LOAD_ORDER) {
      if (sizes[key]! > 0) this.entities[key] = { done: 0, total: sizes[key]! };
    }
    this.dirty = true;
  }

  snapshot(): RunProgress {
    return { at: new Date().toISOString(), current: this.current, entities: { ...this.entities } };
  }

  output(): string {
    const text = this.lines.join("\n");
    if (text.length <= OUTPUT_CAP) return text;
    const head = text.slice(0, OUTPUT_CAP / 8);
    const tail = text.slice(-(OUTPUT_CAP - OUTPUT_CAP / 8));
    return `${head}\n… log trimmed to its first and last parts …\n${tail}`;
  }

  start(): void {
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_MS);
    this.timer.unref();
  }

  /** Stop the timer and let an in-flight write land; the caller writes the final state. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.writing;
  }

  private async flush(): Promise<void> {
    if (this.writing) return;
    if (!this.dirty && Date.now() - this.lastWrite < HEARTBEAT_MS) return;
    this.dirty = false;
    this.lastWrite = Date.now();
    this.writing = this.pool
      .query(`UPDATE xcf_migration_runs SET output = $2, progress = $3 WHERE id = $1 AND status = 'running'`,
        [this.runId, this.output(), JSON.stringify(this.snapshot())])
      .then(() => undefined)
      // A missed write costs one second of staleness; it must never fail the import.
      .catch(() => { this.dirty = true; })
      .finally(() => { this.writing = null; });
    await this.writing;
  }
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
