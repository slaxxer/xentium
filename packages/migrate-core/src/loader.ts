import crypto from "node:crypto";
import pg from "pg";
import { uniqueSlug } from "@nodevo/sdk";
import { htmlToTipTap, htmlToText } from "./htmlToTipTap.js";
import type {
  ExtractResult, ImportedArticle, ImportedCategory, ImportedComment, ImportedUser,
  ImportError, MigrationReporter,
} from "./types.js";

/**
 * Loads the platform-neutral intermediate model into a Nodevo database.
 *
 * Written once, used by every adapter. Direct SQL (spec §34 sanctions direct
 * DB writes — REST is impractical for bulk imports); search vectors are
 * maintained by DB triggers so inserted rows are indexed automatically.
 *
 * Resumability: every imported entity is recorded in import_map keyed by
 * (platform, entity, source_id). A re-run skips everything already mapped, so
 * a crashed migration continues instead of duplicating.
 *
 * Failure model: per-row try/catch — one bad source row is reported and
 * skipped, never aborts the run (status becomes "partial").
 */
export class NodevoLoader {
  private groupIdByKey = new Map<string, string>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly platform: string,
    private readonly runId: string | null,
    private readonly reporter: MigrationReporter,
    readonly errors: ImportError[] = [],
  ) {}

  /** Entity → number of rows actually inserted (mapped-to-existing excluded). */
  readonly counts: Record<string, number> = {};

  // ── import_map ─────────────────────────────────────────────────────────────

  private async mapped(entity: string, sourceId: string): Promise<string | null> {
    const res = await this.pool.query(
      `SELECT nodevo_id FROM import_map WHERE platform = $1 AND entity = $2 AND source_id = $3`,
      [this.platform, entity, sourceId],
    );
    return res.rows[0]?.nodevo_id ?? null;
  }

  private async remember(entity: string, sourceId: string, nodevoId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO import_map (id, run_id, platform, entity, source_id, nodevo_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), this.runId, this.platform, entity, sourceId, nodevoId],
    );
  }

  private fail(entity: string, sourceId: string, reason: string): void {
    this.errors.push({ entity, sourceId, reason });
  }

  private bump(entity: string): void {
    this.counts[entity] = (this.counts[entity] ?? 0) + 1;
  }

  // ── preconditions ──────────────────────────────────────────────────────────

  /** The target must be an installed Nodevo database. */
  async assertTargetReady(): Promise<void> {
    const install = await this.pool
      .query(`SELECT "completedAt" FROM installs LIMIT 1`)
      .catch(() => null);
    if (!install?.rows[0]?.completedAt) {
      throw new Error("Target is not an installed Nodevo database — complete the install wizard first.");
    }
    const groups = await this.pool.query(`SELECT id, key FROM "Group"`);
    for (const row of groups.rows) this.groupIdByKey.set(row.key, row.id);
    if (!this.groupIdByKey.has("member")) {
      throw new Error('Target database has no "member" group — seeding incomplete?');
    }
  }

  // ── users ──────────────────────────────────────────────────────────────────

  async loadUsers(users: ImportedUser[]): Promise<void> {
    let done = 0;
    for (const user of users) {
      try {
        await this.loadUser(user);
      } catch (err) {
        this.fail("user", user.sourceId, (err as Error).message);
      }
      this.reporter.progress("users", ++done, users.length);
    }
  }

  private async loadUser(user: ImportedUser): Promise<void> {
    if (await this.mapped("user", user.sourceId)) return;

    // Same email = same person: map to the existing account, import nothing.
    const existing = await this.pool.query(
      `SELECT id FROM "User" WHERE lower(email) = lower($1)`,
      [user.email],
    );
    if (existing.rows[0]) {
      await this.remember("user", user.sourceId, existing.rows[0].id);
      return;
    }

    const username = await this.dedupeUsername(user.username);
    const id = crypto.randomUUID();
    // No source hash (e.g. WXR file export): unusable marker — never verifies
    // under any scheme, the user resets their password once.
    const passwordHash = user.passwordHash ?? `!imported:${crypto.randomBytes(24).toString("hex")}`;
    const scheme = user.passwordHash ? (user.passwordScheme ?? "argon2") : "argon2";
    const joined = user.joinedAt ?? new Date();

    await this.pool.query(
      `INSERT INTO "User" (id, email, username, "passwordHash", password_scheme,
                           display_name, bio, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW())`,
      [id, user.email, username, passwordHash, scheme, user.displayName ?? null, user.bio ?? null, joined],
    );

    // Best-effort role mapping (§34, lossy by design). Unknown keys → member.
    const groupKey = user.role && this.groupIdByKey.has(user.role) ? user.role : "member";
    await this.pool.query(
      `INSERT INTO "UserGroup" ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, this.groupIdByKey.get(groupKey)],
    );
    // Privacy row exists for every user (§37) — registration normally creates it.
    await this.pool.query(
      `INSERT INTO user_privacy_settings (user_id, settings, updated_at)
       VALUES ($1, '{}', NOW()) ON CONFLICT DO NOTHING`,
      [id],
    );

    await this.remember("user", user.sourceId, id);
    this.bump("users");
  }

  private async dedupeUsername(base: string): Promise<string> {
    const clean = base.trim() || "imported-user";
    let candidate = clean;
    let n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await this.pool.query(
        `SELECT 1 FROM "User" WHERE lower(username) = lower($1)`,
        [candidate],
      );
      if (!taken.rows[0]) return candidate;
      candidate = `${clean}-${n++}`;
    }
  }

  // ── categories ─────────────────────────────────────────────────────────────

  async loadCategories(categories: ImportedCategory[]): Promise<void> {
    // Parents before children — iterate until no progress (cycles → error).
    const pending = [...categories];
    let progressed = true;
    while (pending.length && progressed) {
      progressed = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const cat = pending[i]!;
        const parentReady =
          !cat.parentSourceId || (await this.mapped("category", cat.parentSourceId)) !== null;
        if (!parentReady) continue;
        try {
          await this.loadCategory(cat);
        } catch (err) {
          this.fail("category", cat.sourceId, (err as Error).message);
        }
        pending.splice(i, 1);
        progressed = true;
      }
    }
    for (const cat of pending) {
      this.fail("category", cat.sourceId, `parent "${cat.parentSourceId}" was never imported`);
    }
  }

  private async loadCategory(cat: ImportedCategory): Promise<void> {
    if (await this.mapped("category", cat.sourceId)) return;

    const parentId = cat.parentSourceId ? await this.mapped("category", cat.parentSourceId) : null;
    const slug = await uniqueSlug(cat.name, async (s) => {
      const r = await this.pool.query(`SELECT 1 FROM article_categories WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO article_categories (id, parent_id, name, slug, description, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())`,
      [id, parentId, cat.name, slug, cat.description ?? null],
    );
    await this.remember("category", cat.sourceId, id);
    this.bump("categories");
  }

  // ── articles ───────────────────────────────────────────────────────────────

  async loadArticles(articles: ImportedArticle[]): Promise<void> {
    let done = 0;
    for (const article of articles) {
      try {
        await this.loadArticle(article);
      } catch (err) {
        this.fail("article", article.sourceId, (err as Error).message);
      }
      this.reporter.progress("articles", ++done, articles.length);
    }
  }

  private async loadArticle(article: ImportedArticle): Promise<void> {
    if (await this.mapped("article", article.sourceId)) return;

    const authorId = await this.mapped("user", article.authorSourceId);
    if (!authorId) throw new Error(`author "${article.authorSourceId}" was not imported`);
    const categoryId = article.categorySourceId
      ? await this.mapped("category", article.categorySourceId)
      : null;

    const slug = await uniqueSlug(article.title, async (s) => {
      const r = await this.pool.query(`SELECT 1 FROM articles WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const body = htmlToTipTap(article.contentHtml);
    const bodyPlain = htmlToText(article.contentHtml);
    const created = article.createdAt ?? article.publishedAt ?? new Date();
    const id = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO articles (id, author_id, category_id, title, slug, excerpt, body, body_plain,
                             status, visibility, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'public', $10, $11, NOW())`,
      [
        id, authorId, categoryId, article.title, slug,
        article.excerpt || bodyPlain.slice(0, 280) || null,
        JSON.stringify(body), bodyPlain,
        article.status,
        article.status === "published" ? article.publishedAt ?? created : null,
        created,
      ],
    );

    for (const tagName of article.tags ?? []) {
      await this.linkTag(id, tagName);
    }

    await this.remember("article", article.sourceId, id);
    this.bump("articles");
  }

  private async linkTag(articleId: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    const existing = await this.pool.query(`SELECT id FROM tags WHERE lower(name) = lower($1)`, [clean]);
    let tagId: string = existing.rows[0]?.id;
    if (!tagId) {
      tagId = crypto.randomUUID();
      const slug = await uniqueSlug(clean, async (s) => {
        const r = await this.pool.query(`SELECT 1 FROM tags WHERE slug = $1`, [s]);
        return !!r.rows[0];
      });
      await this.pool.query(`INSERT INTO tags (id, name, slug) VALUES ($1, $2, $3)`, [tagId, clean, slug]);
    }
    await this.pool.query(
      `INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [articleId, tagId],
    );
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(comments: ImportedComment[]): Promise<void> {
    // Nodevo threads one level deep (§33): replies-to-replies attach to the
    // top-level ancestor. Track each inserted comment's parent to flatten.
    const inserted = new Map<string, { id: string; parentDbId: string | null }>();
    let done = 0;
    for (const comment of comments) {
      try {
        await this.loadComment(comment, inserted);
      } catch (err) {
        this.fail("comment", comment.sourceId, (err as Error).message);
      }
      this.reporter.progress("comments", ++done, comments.length);
    }
  }

  private async loadComment(
    comment: ImportedComment,
    inserted: Map<string, { id: string; parentDbId: string | null }>,
  ): Promise<void> {
    if (await this.mapped("comment", comment.sourceId)) return;

    const articleId = await this.mapped("article", comment.articleSourceId);
    if (!articleId) throw new Error(`article "${comment.articleSourceId}" was not imported`);
    const authorId = await this.mapped("user", comment.authorSourceId);
    if (!authorId) throw new Error(`author "${comment.authorSourceId}" was not imported`);

    let parentDbId: string | null = null;
    if (comment.parentSourceId) {
      const parent = inserted.get(comment.parentSourceId);
      if (parent) {
        parentDbId = parent.parentDbId ?? parent.id; // flatten depth > 1
      } else {
        const mappedParent = await this.mapped("comment", comment.parentSourceId);
        parentDbId = mappedParent; // resumed run: parent imported previously
      }
    }

    const id = crypto.randomUUID();
    const created = comment.createdAt ?? new Date();
    await this.pool.query(
      `INSERT INTO article_comments (id, article_id, author_id, parent_id, body, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'published', $6, NOW())`,
      [id, articleId, authorId, parentDbId, comment.bodyText, created],
    );
    inserted.set(comment.sourceId, { id, parentDbId });
    await this.remember("comment", comment.sourceId, id);
    this.bump("comments");
  }

  // ── denormalized counters (§38/§46) ───────────────────────────────────────

  async recomputeCounters(): Promise<void> {
    await this.pool.query(`
      UPDATE articles a SET comment_count = sub.n
      FROM (SELECT article_id, COUNT(*)::int AS n
            FROM article_comments WHERE deleted_at IS NULL GROUP BY article_id) sub
      WHERE a.id = sub.article_id`);
    await this.pool.query(`
      UPDATE "User" u SET article_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n
            FROM articles WHERE deleted_at IS NULL AND status = 'published'
            GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
  }

  /** Run everything in dependency order. */
  async loadAll(extract: ExtractResult): Promise<void> {
    await this.assertTargetReady();
    this.reporter.info(`Importing ${extract.users.length} users…`);
    await this.loadUsers(extract.users);
    this.reporter.info(`Importing ${extract.categories.length} categories…`);
    await this.loadCategories(extract.categories);
    this.reporter.info(`Importing ${extract.articles.length} articles…`);
    await this.loadArticles(extract.articles);
    this.reporter.info(`Importing ${extract.comments.length} comments…`);
    await this.loadComments(extract.comments);
    this.reporter.info("Recomputing denormalized counters…");
    await this.recomputeCounters();
  }
}
