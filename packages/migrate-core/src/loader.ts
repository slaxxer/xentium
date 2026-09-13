import crypto from "node:crypto";
import pg from "pg";
import { uniqueSlug } from "@nodevo/sdk";
import { htmlToTipTap, htmlToText } from "./htmlToTipTap.js";
import type {
  ExtractResult, ImportedArticle, ImportedBlock, ImportedCategory, ImportedComment,
  ImportedFollow, ImportedForumNode, ImportedPost, ImportedPostLike, ImportedThread,
  ImportedUser, ImportError, MigrationReporter,
} from "./types.js";

/**
 * Loads the platform-neutral intermediate model into a Xentium database.
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
export class XentiumLoader {
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
      `SELECT nodevo_id FROM ncf_import_map WHERE platform = $1 AND entity = $2 AND source_id = $3`,
      [this.platform, entity, sourceId],
    );
    return res.rows[0]?.nodevo_id ?? null;
  }

  private async remember(entity: string, sourceId: string, xentiumId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ncf_import_map (id, run_id, platform, entity, source_id, nodevo_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), this.runId, this.platform, entity, sourceId, xentiumId],
    );
  }

  private fail(entity: string, sourceId: string, reason: string): void {
    this.errors.push({ entity, sourceId, reason });
  }

  private bump(entity: string): void {
    this.counts[entity] = (this.counts[entity] ?? 0) + 1;
  }

  // ── preconditions ──────────────────────────────────────────────────────────

  /** The target must be an installed Xentium database. */
  async assertTargetReady(requiredPlugins: string[] = []): Promise<void> {
    const install = await this.pool
      .query(`SELECT "completedAt" FROM ncf_installs LIMIT 1`)
      .catch(() => null);
    if (!install?.rows[0]?.completedAt) {
      throw new Error("Target is not an installed Xentium database — complete the install wizard first.");
    }
    const groups = await this.pool.query(`SELECT id, key FROM ncf_groups`);
    for (const row of groups.rows) this.groupIdByKey.set(row.key, row.id);
    if (!this.groupIdByKey.has("member")) {
      throw new Error('Target database has no "member" group — seeding incomplete?');
    }
    const missing = await missingPlugins(this.pool, requiredPlugins);
    if (missing.length) {
      throw new Error(
        `Required plugin(s) not enabled on the target: ${missing.join(", ")}. ` +
        `Install + enable them in ACP → Extensions first — nothing was touched.`,
      );
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
      `SELECT id FROM ncf_users WHERE lower(email) = lower($1)`,
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
      `INSERT INTO ncf_users (id, email, username, "passwordHash", password_scheme,
                           display_name, bio, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW())`,
      [id, user.email, username, passwordHash, scheme, user.displayName ?? null, user.bio ?? null, joined],
    );

    // Best-effort role mapping (§34, lossy by design). Unknown keys → member.
    const groupKey = user.role && this.groupIdByKey.has(user.role) ? user.role : "member";
    await this.pool.query(
      `INSERT INTO ncf_user_groups ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, this.groupIdByKey.get(groupKey)],
    );
    // Privacy row exists for every user (§37) — registration normally creates it.
    await this.pool.query(
      `INSERT INTO ncf_user_privacy_settings (user_id, settings, updated_at)
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
        `SELECT 1 FROM ncf_users WHERE lower(username) = lower($1)`,
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
      const r = await this.pool.query(`SELECT 1 FROM ncf_article_categories WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO ncf_article_categories (id, parent_id, name, slug, description, position, created_at, updated_at)
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
      const r = await this.pool.query(`SELECT 1 FROM ncf_articles WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const body = htmlToTipTap(article.contentHtml);
    const bodyPlain = htmlToText(article.contentHtml);
    const created = article.createdAt ?? article.publishedAt ?? new Date();
    const id = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO ncf_articles (id, author_id, category_id, title, slug, excerpt, body, body_plain,
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
    const existing = await this.pool.query(`SELECT id FROM ncf_tags WHERE lower(name) = lower($1)`, [clean]);
    let tagId: string = existing.rows[0]?.id;
    if (!tagId) {
      tagId = crypto.randomUUID();
      const slug = await uniqueSlug(clean, async (s) => {
        const r = await this.pool.query(`SELECT 1 FROM ncf_tags WHERE slug = $1`, [s]);
        return !!r.rows[0];
      });
      await this.pool.query(`INSERT INTO ncf_tags (id, name, slug) VALUES ($1, $2, $3)`, [tagId, clean, slug]);
    }
    await this.pool.query(
      `INSERT INTO ncf_article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [articleId, tagId],
    );
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(comments: ImportedComment[]): Promise<void> {
    // Xentium threads one level deep (§33): replies-to-replies attach to the
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
      `INSERT INTO ncf_article_comments (id, article_id, author_id, parent_id, body, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'published', $6, NOW())`,
      [id, articleId, authorId, parentDbId, comment.bodyText, created],
    );
    inserted.set(comment.sourceId, { id, parentDbId });
    await this.remember("comment", comment.sourceId, id);
    this.bump("comments");
  }

  // ── forum (nodevo-forum plugin tables — gated by assertTargetReady) ───────

  async loadForumNodes(nodes: ImportedForumNode[]): Promise<void> {
    const pending = [...nodes];
    let progressed = true;
    while (pending.length && progressed) {
      progressed = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const node = pending[i]!;
        const parentReady =
          !node.parentSourceId || (await this.mapped("forum_node", node.parentSourceId)) !== null;
        if (!parentReady) continue;
        try {
          await this.loadForumNode(node);
        } catch (err) {
          this.fail("forum_node", node.sourceId, (err as Error).message);
        }
        pending.splice(i, 1);
        progressed = true;
      }
    }
    for (const node of pending) {
      this.fail("forum_node", node.sourceId, `parent "${node.parentSourceId}" was never imported`);
    }
  }

  private async loadForumNode(node: ImportedForumNode): Promise<void> {
    if (await this.mapped("forum_node", node.sourceId)) return;

    const parentId = node.parentSourceId ? await this.mapped("forum_node", node.parentSourceId) : null;
    const slug = await uniqueSlug(node.name, async (s) => {
      const r = await this.pool.query(`SELECT 1 FROM forum_nodes WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO forum_nodes (id, parent_id, type, name, slug, description, position, allow_threads)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, parentId, node.type, node.name, slug, node.description ?? null, node.position ?? 0, node.type === "forum"],
    );
    await this.remember("forum_node", node.sourceId, id);
    this.bump("forumNodes");
  }

  async loadThreads(threads: ImportedThread[]): Promise<void> {
    let done = 0;
    for (const thread of threads) {
      try {
        await this.loadThread(thread);
      } catch (err) {
        this.fail("thread", thread.sourceId, (err as Error).message);
      }
      this.reporter.progress("threads", ++done, threads.length);
    }
  }

  private async loadThread(thread: ImportedThread): Promise<void> {
    if (await this.mapped("thread", thread.sourceId)) return;

    const nodeId = await this.mapped("forum_node", thread.nodeSourceId);
    if (!nodeId) throw new Error(`forum node "${thread.nodeSourceId}" was not imported`);
    const authorId = await this.mapped("user", thread.authorSourceId);
    if (!authorId) throw new Error(`author "${thread.authorSourceId}" was not imported`);

    const slug = await uniqueSlug(thread.title, async (s) => {
      const r = await this.pool.query(`SELECT 1 FROM forum_threads WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO forum_threads (id, node_id, author_id, title, slug, status, is_pinned, view_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [id, nodeId, authorId, thread.title, slug, thread.status ?? "open",
       thread.isPinned ?? false, thread.viewCount ?? 0, thread.createdAt ?? new Date()],
    );
    await this.remember("thread", thread.sourceId, id);
    this.bump("threads");
  }

  async loadPosts(posts: ImportedPost[]): Promise<void> {
    let done = 0;
    for (const post of posts) {
      try {
        await this.loadPost(post);
      } catch (err) {
        this.fail("post", post.sourceId, (err as Error).message);
      }
      this.reporter.progress("posts", ++done, posts.length);
    }
  }

  private async loadPost(post: ImportedPost): Promise<void> {
    if (await this.mapped("post", post.sourceId)) return;

    const threadId = await this.mapped("thread", post.threadSourceId);
    if (!threadId) throw new Error(`thread "${post.threadSourceId}" was not imported`);
    const authorId = await this.mapped("user", post.authorSourceId);
    if (!authorId) throw new Error(`author "${post.authorSourceId}" was not imported`);

    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO forum_posts (id, thread_id, author_id, body, edited_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, threadId, authorId, post.bodyHtml, post.editedAt ?? null, post.createdAt ?? new Date()],
    );
    await this.remember("post", post.sourceId, id);
    this.bump("posts");
  }

  private async recomputeForumCounters(): Promise<void> {
    // Threads: reply_count (posts beyond the first), last post info.
    await this.pool.query(`
      UPDATE forum_threads t SET
        reply_count    = GREATEST(sub.n - 1, 0),
        last_post_at   = sub.last_at,
        last_poster_id = sub.last_author
      FROM (
        SELECT thread_id, COUNT(*)::int AS n, MAX(created_at) AS last_at,
               (ARRAY_AGG(author_id ORDER BY created_at DESC))[1] AS last_author
        FROM forum_posts WHERE deleted_at IS NULL GROUP BY thread_id
      ) sub WHERE t.id = sub.thread_id`);
    // Nodes: thread/post counts + last activity (direct children only — the
    // forum frontend aggregates the tree itself).
    await this.pool.query(`
      UPDATE forum_nodes n SET
        thread_count   = sub.threads,
        post_count     = sub.posts,
        last_post_at   = sub.last_at,
        last_thread_id = sub.last_thread
      FROM (
        SELECT t.node_id,
               COUNT(DISTINCT t.id)::int AS threads,
               COUNT(p.id)::int AS posts,
               MAX(p.created_at) AS last_at,
               (ARRAY_AGG(t.id ORDER BY p.created_at DESC))[1] AS last_thread
        FROM forum_threads t
        LEFT JOIN forum_posts p ON p.thread_id = t.id AND p.deleted_at IS NULL
        WHERE t.deleted_at IS NULL
        GROUP BY t.node_id
      ) sub WHERE n.id = sub.node_id`);
    // Users: forum activity counters (§38).
    await this.pool.query(`
      UPDATE ncf_users u SET post_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n FROM forum_posts
            WHERE deleted_at IS NULL GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
    await this.pool.query(`
      UPDATE ncf_users u SET thread_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n FROM forum_threads
            WHERE deleted_at IS NULL GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
  }

  // ── social graph (blocks → follows → likes; §36 rules) ────────────────────

  /** Blocks load FIRST: §36 — a block suppresses follows in both directions. */
  async loadBlocks(blocks: ImportedBlock[]): Promise<void> {
    for (const block of blocks) {
      try {
        const blockerId = await this.mapped("user", block.blockerSourceId);
        const blockedId = await this.mapped("user", block.blockedSourceId);
        if (!blockerId || !blockedId) throw new Error("user not imported");
        if (blockerId === blockedId) continue;
        const res = await this.pool.query(
          `INSERT INTO ncf_user_blocks (id, blocker_id, blocked_id, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), blockerId, blockedId, block.createdAt ?? new Date()],
        );
        if (res.rowCount) this.bump("blocks");
      } catch (err) {
        this.fail("block", `${block.blockerSourceId}->${block.blockedSourceId}`, (err as Error).message);
      }
    }
  }

  async loadFollows(follows: ImportedFollow[]): Promise<void> {
    for (const follow of follows) {
      try {
        const followerId = await this.mapped("user", follow.followerSourceId);
        const followingId = await this.mapped("user", follow.followingSourceId);
        if (!followerId || !followingId) throw new Error("user not imported");
        if (followerId === followingId) continue;
        // §36: a block in either direction kills the follow relationship.
        const blocked = await this.pool.query(
          `SELECT 1 FROM ncf_user_blocks
           WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
          [followerId, followingId],
        );
        if (blocked.rows[0]) continue;
        const res = await this.pool.query(
          `INSERT INTO ncf_user_follows (id, follower_id, following_id, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), followerId, followingId, follow.createdAt ?? new Date()],
        );
        if (res.rowCount) this.bump("follows");
      } catch (err) {
        this.fail("follow", `${follow.followerSourceId}->${follow.followingSourceId}`, (err as Error).message);
      }
    }
  }

  async loadPostLikes(likes: ImportedPostLike[]): Promise<void> {
    let done = 0;
    for (const like of likes) {
      try {
        const postId = await this.mapped("post", like.postSourceId);
        const userId = await this.mapped("user", like.userSourceId);
        if (!postId || !userId) throw new Error("post or user not imported");
        const res = await this.pool.query(
          `INSERT INTO forum_post_likes (id, post_id, user_id, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), postId, userId, like.createdAt ?? new Date()],
        );
        if (res.rowCount) this.bump("postLikes");
      } catch (err) {
        this.fail("post_like", `${like.postSourceId}<-${like.userSourceId}`, (err as Error).message);
      }
      this.reporter.progress("post likes", ++done, likes.length);
    }
  }

  private async recomputeSocialCounters(): Promise<void> {
    await this.pool.query(`
      UPDATE forum_posts p SET like_count = sub.n
      FROM (SELECT post_id, COUNT(*)::int AS n FROM forum_post_likes GROUP BY post_id) sub
      WHERE p.id = sub.post_id`);
    // Likes received on the user's posts (§38/§45).
    await this.pool.query(`
      UPDATE ncf_users u SET like_count_received = sub.n
      FROM (SELECT p.author_id, COUNT(*)::int AS n
            FROM forum_post_likes l JOIN forum_posts p ON p.id = l.post_id
            WHERE p.deleted_at IS NULL GROUP BY p.author_id) sub
      WHERE u.id = sub.author_id`);
    await this.pool.query(`
      UPDATE ncf_users u SET follower_count = COALESCE(sub.n, 0)
      FROM (SELECT following_id, COUNT(*)::int AS n FROM ncf_user_follows GROUP BY following_id) sub
      WHERE u.id = sub.following_id`);
    await this.pool.query(`
      UPDATE ncf_users u SET following_count = COALESCE(sub.n, 0)
      FROM (SELECT follower_id, COUNT(*)::int AS n FROM ncf_user_follows GROUP BY follower_id) sub
      WHERE u.id = sub.follower_id`);
  }

  // ── denormalized counters (§38/§46) ───────────────────────────────────────

  async recomputeCounters(): Promise<void> {
    await this.pool.query(`
      UPDATE ncf_articles a SET comment_count = sub.n
      FROM (SELECT article_id, COUNT(*)::int AS n
            FROM ncf_article_comments WHERE deleted_at IS NULL GROUP BY article_id) sub
      WHERE a.id = sub.article_id`);
    await this.pool.query(`
      UPDATE ncf_users u SET article_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n
            FROM ncf_articles WHERE deleted_at IS NULL AND status = 'published'
            GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
  }

  /** Run everything in dependency order. */
  async loadAll(extract: ExtractResult, requiredPlugins: string[] = []): Promise<void> {
    await this.assertTargetReady(requiredPlugins);
    this.reporter.info(`Importing ${extract.users.length} users…`);
    await this.loadUsers(extract.users);
    this.reporter.info(`Importing ${extract.categories.length} categories…`);
    await this.loadCategories(extract.categories);
    this.reporter.info(`Importing ${extract.articles.length} articles…`);
    await this.loadArticles(extract.articles);
    this.reporter.info(`Importing ${extract.comments.length} comments…`);
    await this.loadComments(extract.comments);
    if (extract.forumNodes?.length || extract.threads?.length || extract.posts?.length) {
      this.reporter.info(`Importing ${extract.forumNodes?.length ?? 0} forum nodes…`);
      await this.loadForumNodes(extract.forumNodes ?? []);
      this.reporter.info(`Importing ${extract.threads?.length ?? 0} threads…`);
      await this.loadThreads(extract.threads ?? []);
      this.reporter.info(`Importing ${extract.posts?.length ?? 0} posts…`);
      await this.loadPosts(extract.posts ?? []);
      this.reporter.info("Recomputing forum counters…");
      await this.recomputeForumCounters();
    }
    if (extract.blocks?.length || extract.follows?.length || extract.postLikes?.length) {
      this.reporter.info(`Importing social graph (${extract.blocks?.length ?? 0} blocks, ${extract.follows?.length ?? 0} follows, ${extract.postLikes?.length ?? 0} post likes)…`);
      await this.loadBlocks(extract.blocks ?? []);
      await this.loadFollows(extract.follows ?? []);
      await this.loadPostLikes(extract.postLikes ?? []);
      this.reporter.info("Recomputing social counters…");
      await this.recomputeSocialCounters();
    }
    this.reporter.info("Recomputing denormalized counters…");
    await this.recomputeCounters();
  }
}

/** Which of `required` plugin ids are NOT enabled on the target. */
export async function missingPlugins(pool: pg.Pool, required: string[]): Promise<string[]> {
  if (!required.length) return [];
  const res = await pool
    .query(`SELECT id FROM ncf_installed_plugins WHERE status = 'enabled' AND id = ANY($1)`, [required])
    .catch(() => ({ rows: [] as Array<{ id: string }> }));
  const enabled = new Set(res.rows.map((r) => r.id));
  return required.filter((id) => !enabled.has(id));
}
