import crypto from "node:crypto";
import pg from "pg";
import { NodevoLoader, missingPlugins } from "./loader.js";
import type { AdapterSource, MigrateAdapter, MigrationReporter, MigrationSummary } from "./types.js";

export interface RunOptions {
  /** Target Nodevo PostgreSQL connection string. */
  targetDb: string;
  /** Inspect + extract + report, write nothing (the safe community-beta mode). */
  dryRun?: boolean;
}

/**
 * Orchestrates a full migration run: extract → load → migration_runs log row
 * (§34 — the ACP Migration History page reads these). Dry runs write nothing,
 * including the log row.
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

    const extract = await adapter.extract(source, reporter);

    if (options.dryRun) {
      reporter.info("Dry run — nothing was written. Counts below reflect what a real run would import.");
      const counts: Record<string, number> = {
        users: extract.users.length,
        categories: extract.categories.length,
        articles: extract.articles.length,
        comments: extract.comments.length,
      };
      if (extract.forumNodes) counts.forumNodes = extract.forumNodes.length;
      if (extract.threads) counts.threads = extract.threads.length;
      if (extract.posts) counts.posts = extract.posts.length;
      return {
        counts,
        errors: extract.skipped,
        durationMs: Date.now() - startedAt.getTime(),
      };
    }

    const runId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO ncf_migration_runs (id, adapter, adapter_ver, source_info, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', $5)`,
      [runId, adapter.name, adapter.version, extract.sourceInfo, startedAt],
    );

    const loader = new NodevoLoader(pool, adapter.name, runId, reporter);
    try {
      await loader.loadAll(extract, adapter.requiredPlugins ?? []);
    } catch (err) {
      // Hard failure (lost DB, bad target, …): the log row must not stay
      // "running" forever — mark it failed before rethrowing.
      await pool.query(
        `UPDATE ncf_migration_runs
         SET status = 'failed', completed_at = NOW(), errors = $2
         WHERE id = $1`,
        [runId, JSON.stringify([{ entity: "run", sourceId: "-", reason: (err as Error).message }])],
      ).catch(() => { /* connection may be gone */ });
      throw err;
    }

    const errors = [...extract.skipped, ...loader.errors];
    const durationMs = Date.now() - startedAt.getTime();
    const status = errors.length ? "partial" : "completed";
    await pool.query(
      `UPDATE ncf_migration_runs
       SET status = $2, completed_at = NOW(), "durationMs" = $3, summary = $4, errors = $5
       WHERE id = $1`,
      [runId, status, durationMs, JSON.stringify(loader.counts), JSON.stringify(errors.slice(0, 500))],
    );

    return { counts: loader.counts, errors, durationMs };
  } finally {
    await pool.end();
  }
}
