import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pagesOf, sizeOf, type Rows } from "./batches.js";
import { sanitizeImportedPost } from "./sanitize.js";
import pg from "pg";
import { uniqueSlug } from "@xentium/sdk";
import { htmlToTipTap, htmlToText } from "./htmlToTipTap.js";
import type {
  ExtractResult, ImportedArticle, ImportedBlock, ImportedCategory, ImportedComment,
  ImportedBan, ImportedConversation, ImportedFollow, ImportedForumNode, ImportedGroup, ImportedPrefix, ImportedMessage, ImportedPost, ImportedPostLike,
  ImportedProfileComment, ImportedSubscription, ImportedThread, ImportedWarning,
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
/** How a platform is written for people (a renamed group says where it came from). */
const PLATFORM_NAMES: Record<string, string> = {
  phpbb: "phpBB", xenforo: "XenForo", vbulletin: "vBulletin", woltlab: "WoltLab", wordpress: "WordPress",
};

export class XentiumLoader {
  private groupIdByKey = new Map<string, string>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly platform: string,
    private readonly runId: string | null,
    private readonly reporter: MigrationReporter,
    readonly errors: ImportError[] = [],
  ) {}

  /** Xentium's upload folder (UPLOAD_DIR). Avatars are written into its avatars/
   *  folder; without it they are left out and reported. */
  uploadsDir: string | null = null;
  private avatarsWithoutUploads = 0;

  /** Entity → number of rows actually inserted (mapped-to-existing excluded). */
  readonly counts: Record<string, number> = {};

  // ── import_map ─────────────────────────────────────────────────────────────

  /**
   * Users, boards, threads and conversations are looked up for every post and message,
   * so their ids stay in memory once known: a board has far fewer of them than posts,
   * and a million-post import would otherwise ask the database millions of times.
   * Posts and messages themselves are never cached (there are too many).
   */
  private readonly idCache = new Map<string, string>();
  private static readonly CACHED = new Set(["user", "forum_node", "thread", "conversation"]);

  private async mapped(entity: string, sourceId: string): Promise<string | null> {
    const cacheKey = `${entity}\0${sourceId}`;
    const hit = this.idCache.get(cacheKey);
    if (hit) return hit;
    const res = await this.pool.query(
      `SELECT xentium_id FROM xcf_import_map WHERE platform = $1 AND entity = $2 AND source_id = $3`,
      [this.platform, entity, sourceId],
    );
    const id: string | null = res.rows[0]?.xentium_id ?? null;
    if (id && XentiumLoader.CACHED.has(entity)) this.idCache.set(cacheKey, id);
    return id;
  }

  /** Which of these source ids are already imported: one query per page, for re-runs. */
  private async mappedAmong(entity: string, sourceIds: string[]): Promise<Set<string>> {
    if (!sourceIds.length) return new Set();
    const res = await this.pool.query(
      `SELECT source_id FROM xcf_import_map WHERE platform = $1 AND entity = $2 AND source_id = ANY($3::text[])`,
      [this.platform, entity, sourceIds],
    );
    return new Set((res.rows as Array<{ source_id: string }>).map((r) => r.source_id));
  }

  private async remember(entity: string, sourceId: string, xentiumId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO xcf_import_map (id, run_id, platform, entity, source_id, xentium_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), this.runId, this.platform, entity, sourceId, xentiumId],
    );
    if (XentiumLoader.CACHED.has(entity)) this.idCache.set(`${entity}\0${sourceId}`, xentiumId);
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
      .query(`SELECT "completedAt" FROM xcf_installs LIMIT 1`)
      .catch(() => null);
    if (!install?.rows[0]?.completedAt) {
      throw new Error("Target is not an installed Xentium database — complete the install wizard first.");
    }
    const groups = await this.pool.query(`SELECT id, key FROM xcf_groups`);
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

  // ── groups ─────────────────────────────────────────────────────────────────

  /**
   * Member groups from the old site, by name and with no permissions. A group of the
   * same name that grants nothing (a re-import, or one the admin made ahead) is reused;
   * a name that is taken by a group WITH permissions gets the platform in brackets,
   * because joining it would hand imported members rights they never had.
   */
  async loadGroups(groups: ImportedGroup[]): Promise<void> {
    let done = 0;
    for (const g of groups) {
      try {
        if (!(await this.mapped("group", g.sourceId))) await this.loadGroup(g);
      } catch (err) {
        this.fail("group", g.sourceId, (err as Error).message);
      }
      this.reporter.progress("groups", ++done, groups.length);
    }
  }

  private async loadGroup(g: ImportedGroup): Promise<void> {
    const name = g.name.trim().slice(0, 60) || `Group ${g.sourceId}`;
    const same = await this.pool.query(
      `SELECT g.id, g."isSystem", EXISTS (SELECT 1 FROM xcf_group_permissions gp WHERE gp."groupId" = g.id) AS grants
         FROM xcf_groups g WHERE lower(g.name) = lower($1)`, [name]);
    const reusable = (same.rows as Array<{ id: string; isSystem: boolean; grants: boolean }>).find((r) => !r.isSystem && !r.grants);
    if (reusable) {
      await this.remember("group", g.sourceId, reusable.id);
      return;
    }
    const finalName = same.rows.length ? `${name} (${PLATFORM_NAMES[this.platform] ?? this.platform})` : name;
    const base = (finalName.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "group").padEnd(2, "0");
    let key = base;
    for (let n = 2; (await this.pool.query(`SELECT 1 FROM xcf_groups WHERE key = $1`, [key])).rows[0]; n++) key = `${base}-${n}`;
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO xcf_groups (id, key, name, "isSystem", display_order, show_in_team, "createdAt")
       VALUES ($1, $2, $3, false, 100, false, NOW())`, [id, key, finalName]);
    await this.remember("group", g.sourceId, id);
    this.bump("groups");
  }

  /** The later of their last visit here and on the old site. */
  private async touchLastSeen(userId: string, user: ImportedUser): Promise<void> {
    if (!user.lastSeenAt || Number.isNaN(user.lastSeenAt.getTime()) || user.lastSeenAt.getTime() > Date.now()) return;
    await this.pool.query(
      `UPDATE xcf_users SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2), $2) WHERE id = $1`, [userId, user.lastSeenAt]);
  }

  /** The member's old groups that came over. Joining one grants nothing until an admin says so. */
  private async joinGroups(userId: string, user: ImportedUser): Promise<void> {
    for (const sourceId of user.groupSourceIds ?? []) {
      const groupId = await this.mapped("group", sourceId);
      if (!groupId) continue;
      await this.pool.query(
        `INSERT INTO xcf_user_groups ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, groupId]);
    }
  }

  private async loadUser(user: ImportedUser): Promise<void> {
    const already = await this.mapped("user", user.sourceId);
    if (already) {
      // A re-run (say, now with --uploads) still brings a missing avatar over.
      if (user.avatar) await this.loadAvatar(already, user, true);
      await this.joinGroups(already, user);
      await this.touchLastSeen(already, user);
      return;
    }

    // Same email = same person: map to the existing account, import nothing.
    const existing = await this.pool.query(
      `SELECT id FROM xcf_users WHERE lower(email) = lower($1)`,
      [user.email],
    );
    if (existing.rows[0]) {
      await this.remember("user", user.sourceId, existing.rows[0].id);
      // An existing account keeps its own avatar; one without gets the old one.
      if (user.avatar) await this.loadAvatar(existing.rows[0].id, user, true);
      await this.joinGroups(existing.rows[0].id, user);
      await this.touchLastSeen(existing.rows[0].id, user);
      return;
    }

    const username = await this.dedupeUsername(user.username);
    // A taken name gets a suffix; the report says so, since the member signs in with it.
    if (username !== user.username) {
      this.fail("user", user.sourceId, `username "${user.username}" was taken here, imported as "${username}"`);
    }
    const id = crypto.randomUUID();
    // No source hash (e.g. WXR file export): unusable marker — never verifies
    // under any scheme, the user resets their password once.
    const passwordHash = user.passwordHash ?? `!imported:${crypto.randomBytes(24).toString("hex")}`;
    const scheme = user.passwordHash ? (user.passwordScheme ?? "argon2") : "argon2";
    const joined = user.joinedAt ?? new Date();

    await this.pool.query(
      `INSERT INTO xcf_users (id, email, username, "passwordHash", password_scheme,
                           display_name, bio, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW())`,
      [id, user.email, username, passwordHash, scheme, user.displayName ?? null, user.bio ?? null, joined],
    );

    // Best-effort role mapping (§34, lossy by design). Unknown keys → member.
    const groupKey = user.role && this.groupIdByKey.has(user.role) ? user.role : "member";
    await this.pool.query(
      `INSERT INTO xcf_user_groups ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, this.groupIdByKey.get(groupKey)],
    );
    // Privacy row exists for every user (§37) — registration normally creates it.
    await this.pool.query(
      `INSERT INTO xcf_user_privacy_settings (user_id, settings, updated_at)
       VALUES ($1, '{}', NOW()) ON CONFLICT DO NOTHING`,
      [id],
    );

    await this.loadPersonalInfo(id, user);
    await this.joinGroups(id, user);
    await this.touchLastSeen(id, user);
    if (user.avatar) await this.loadAvatar(id, user);
    await this.remember("user", user.sourceId, id);
    this.bump("users");
  }

/**
   * Copies an avatar into Xentium's uploads, with the same rules a normal upload has:
   * a real JPEG, PNG, GIF or WebP (checked by its first bytes, never by its name) of at
   * most 2 MB. Anything else is left out and reported; the member keeps the default.
   */
  private async loadAvatar(userId: string, user: ImportedUser, onlyIfMissing = false): Promise<void> {
    if (onlyIfMissing) {
      const r = await this.pool.query(`SELECT avatar FROM xcf_users WHERE id = $1`, [userId]);
      if (r.rows[0]?.avatar) return;
    }
    if (!this.uploadsDir) { this.avatarsWithoutUploads++; return; }
    let data = user.avatar?.data ?? null;
    if (!data && user.avatar?.path) data = await fs.readFile(user.avatar.path).catch(() => null);
    if (!data?.length) { this.fail("avatar", user.sourceId, "the avatar file was not found"); return; }
    if (data.length > 2 * 1024 * 1024) { this.fail("avatar", user.sourceId, "larger than 2 MB"); return; }
    const ext = imageType(data);
    if (!ext) { this.fail("avatar", user.sourceId, "not a JPEG, PNG, GIF or WebP image"); return; }
    const dir = path.join(this.uploadsDir, "avatars");
    await fs.mkdir(dir, { recursive: true });
    const file = `${userId}.${ext}`;
    await fs.writeFile(path.join(dir, file), data);
    await this.pool.query(`UPDATE xcf_users SET avatar = $2 WHERE id = $1`, [userId, `avatars/${file}`]);
    this.bump("avatars");
  }

  /** Birthday and website into the system profile fields core seeds on install. */
  private async loadPersonalInfo(userId: string, user: ImportedUser): Promise<void> {
    const values: Array<[string, string]> = [];
    if (user.birthday && /^\d{4}-\d{2}-\d{2}$/.test(user.birthday) && !Number.isNaN(Date.parse(user.birthday))) {
      values.push(["date_of_birth", user.birthday]);
    }
    if (user.website && /^https?:\/\/[^\s"<>]+$/i.test(user.website.trim())) values.push(["website", user.website.trim()]);
    for (const [key, value] of values) {
      await this.pool.query(
        `INSERT INTO xcf_user_profile_field_values (id, user_id, field_id, value, created_at, updated_at)
         SELECT $1, $2, f.id, $3, NOW(), NOW() FROM xcf_user_profile_fields f WHERE f.key = $4
         ON CONFLICT (user_id, field_id) DO NOTHING`,
        [crypto.randomUUID(), userId, value, key],
      );
    }
  }

  private async dedupeUsername(base: string): Promise<string> {
    const clean = base.trim() || "imported-user";
    let candidate = clean;
    let n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await this.pool.query(
        `SELECT 1 FROM xcf_users WHERE lower(username) = lower($1)`,
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
    let done = 0;
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
        this.reporter.progress("categories", ++done, categories.length);
      }
    }
    for (const cat of pending) {
      this.fail("category", cat.sourceId, `parent "${cat.parentSourceId}" was never imported`);
    }
    // Orphans are settled too — as failures — so the phase reads as finished.
    if (pending.length) this.reporter.progress("categories", categories.length, categories.length);
  }

  private async loadCategory(cat: ImportedCategory): Promise<void> {
    if (await this.mapped("category", cat.sourceId)) return;

    const parentId = cat.parentSourceId ? await this.mapped("category", cat.parentSourceId) : null;
    const slug = await uniqueSlug(cat.name, async (s) => {
      const r = await this.pool.query(`SELECT 1 FROM xcf_article_categories WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO xcf_article_categories (id, parent_id, name, slug, description, position, created_at, updated_at)
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
      const r = await this.pool.query(`SELECT 1 FROM xcf_articles WHERE slug = $1`, [s]);
      return !!r.rows[0];
    });
    const body = htmlToTipTap(article.contentHtml);
    const bodyPlain = htmlToText(article.contentHtml);
    const created = article.createdAt ?? article.publishedAt ?? new Date();
    const id = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO xcf_articles (id, author_id, category_id, title, slug, excerpt, body, body_plain,
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
    const existing = await this.pool.query(`SELECT id FROM xcf_tags WHERE lower(name) = lower($1)`, [clean]);
    let tagId: string = existing.rows[0]?.id;
    if (!tagId) {
      tagId = crypto.randomUUID();
      const slug = await uniqueSlug(clean, async (s) => {
        const r = await this.pool.query(`SELECT 1 FROM xcf_tags WHERE slug = $1`, [s]);
        return !!r.rows[0];
      });
      await this.pool.query(`INSERT INTO xcf_tags (id, name, slug) VALUES ($1, $2, $3)`, [tagId, clean, slug]);
    }
    await this.pool.query(
      `INSERT INTO xcf_article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
      `INSERT INTO xcf_article_comments (id, article_id, author_id, parent_id, body, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'published', $6, NOW())`,
      [id, articleId, authorId, parentDbId, comment.bodyText, created],
    );
    inserted.set(comment.sourceId, { id, parentDbId });
    await this.remember("comment", comment.sourceId, id);
    this.bump("comments");
  }

  // ── forum (xentium-forum plugin tables — gated by assertTargetReady) ───────

  /**
   * Thread prefixes. Needs a forum plugin new enough to have them (forum_prefixes);
   * an older one gets everything else and the report says the prefixes waited. A
   * prefix with the same label as one the site has is that prefix.
   */
  async loadPrefixes(prefixes: ImportedPrefix[]): Promise<void> {
    const ready = (await this.pool.query(`SELECT to_regclass('forum_prefixes') AS t`)).rows[0]?.t;
    if (!ready) {
      this.reporter.warn(`${prefixes.length} thread prefix(es) not imported: update the forum plugin to a version with thread prefixes, then run again.`);
      for (const p of prefixes) this.fail("prefix", p.sourceId, "the forum plugin has no thread prefixes yet");
      return;
    }
    let done = 0;
    for (const p of prefixes) {
      try {
        if (!(await this.mapped("prefix", p.sourceId))) await this.loadPrefix(p);
      } catch (err) {
        this.fail("prefix", p.sourceId, (err as Error).message);
      }
      this.reporter.progress("prefixes", ++done, prefixes.length);
    }
  }

  private async loadPrefix(p: ImportedPrefix): Promise<void> {
    const label = p.label.trim().slice(0, 40);
    if (!label) throw new Error("no label");
    const same = await this.pool.query(`SELECT id FROM forum_prefixes WHERE lower(label) = lower($1) LIMIT 1`, [label]);
    if (same.rows[0]) {
      await this.remember("prefix", p.sourceId, same.rows[0].id);
      return;
    }
    const nodeIds: string[] = [];
    for (const n of p.nodeSourceIds ?? []) {
      const id = await this.mapped("forum_node", n);
      if (id) nodeIds.push(id);
    }
    // Offered only in boards that didn't come over: leave it on none rather than all.
    if (p.nodeSourceIds?.length && !nodeIds.length) throw new Error("none of its boards were imported");
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO forum_prefixes (id, label, tone, node_ids, staff_only, position)
       VALUES ($1, $2, $3, $4::text[], false, (SELECT COALESCE(MAX(position), -1) + 1 FROM forum_prefixes))`,
      [id, label, p.tone ?? "neutral", nodeIds]);
    await this.remember("prefix", p.sourceId, id);
    this.bump("prefixes");
  }

  async loadForumNodes(nodes: ImportedForumNode[]): Promise<void> {
    const pending = [...nodes];
    let done = 0;
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
        this.reporter.progress("forumNodes", ++done, nodes.length);
      }
    }
    for (const node of pending) {
      this.fail("forum_node", node.sourceId, `parent "${node.parentSourceId}" was never imported`);
    }
    // Orphans are settled too — as failures — so the phase reads as finished.
    if (pending.length) this.reporter.progress("forumNodes", nodes.length, nodes.length);
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
      `INSERT INTO forum_threads (id, node_id, author_id, title, slug, status, is_pinned, view_count, tags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, NOW())`,
      [id, nodeId, authorId, thread.title, slug, thread.status ?? "open",
       thread.isPinned ?? false, thread.viewCount ?? 0, cleanTags(thread.tags), thread.createdAt ?? new Date()],
    );
    const prefixId = thread.prefixSourceId ? await this.mapped("prefix", thread.prefixSourceId) : null;
    if (prefixId) await this.pool.query(`UPDATE forum_threads SET prefix_id = $2 WHERE id = $1`, [id, prefixId]);
    await this.remember("thread", thread.sourceId, id);
    this.bump("threads");
  }

  async loadPosts(posts: Rows<ImportedPost>): Promise<void> {
    const total = sizeOf(posts);
    let done = 0;
    for await (const page of pagesOf(posts)) {
      const already = await this.mappedAmong("post", page.map((p) => p.sourceId));
      for (const post of page) {
        try {
          if (!already.has(post.sourceId)) await this.loadPost(post);
        } catch (err) {
          this.fail("post", post.sourceId, (err as Error).message);
        }
        this.reporter.progress("posts", ++done, Math.max(total, done));
      }
    }
    // A paged source skips some rows on the way (deleted posts…), so it ends below its total.
    if (done < total) this.reporter.progress("posts", total, total);
  }

  private async loadPost(post: ImportedPost): Promise<void> {

    const threadId = await this.mapped("thread", post.threadSourceId);
    if (!threadId) throw new Error(`thread "${post.threadSourceId}" was not imported`);
    const authorId = await this.mapped("user", post.authorSourceId);
    if (!authorId) throw new Error(`author "${post.authorSourceId}" was not imported`);

    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO forum_posts (id, thread_id, author_id, body, edited_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, threadId, authorId, sanitizeImportedPost(post.bodyHtml), post.editedAt ?? null, post.createdAt ?? new Date()],
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
      UPDATE xcf_users u SET post_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n FROM forum_posts
            WHERE deleted_at IS NULL GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
    await this.pool.query(`
      UPDATE xcf_users u SET thread_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n FROM forum_threads
            WHERE deleted_at IS NULL GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
  }

  // ── social graph (blocks → follows → likes; §36 rules) ────────────────────

  /** Blocks load FIRST: §36 — a block suppresses follows in both directions. */
  async loadBlocks(blocks: ImportedBlock[]): Promise<void> {
    let done = 0;
    for (const block of blocks) {
      try {
        const blockerId = await this.mapped("user", block.blockerSourceId);
        const blockedId = await this.mapped("user", block.blockedSourceId);
        if (!blockerId || !blockedId) throw new Error("user not imported");
        if (blockerId === blockedId) continue;
        const res = await this.pool.query(
          `INSERT INTO xcf_user_blocks (id, blocker_id, blocked_id, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), blockerId, blockedId, block.createdAt ?? new Date()],
        );
        if (res.rowCount) this.bump("blocks");
      } catch (err) {
        this.fail("block", `${block.blockerSourceId}->${block.blockedSourceId}`, (err as Error).message);
      } finally {
        this.reporter.progress("blocks", ++done, blocks.length);
      }
    }
  }

  async loadFollows(follows: ImportedFollow[]): Promise<void> {
    let done = 0;
    for (const follow of follows) {
      try {
        const followerId = await this.mapped("user", follow.followerSourceId);
        const followingId = await this.mapped("user", follow.followingSourceId);
        if (!followerId || !followingId) throw new Error("user not imported");
        if (followerId === followingId) continue;
        // §36: a block in either direction kills the follow relationship.
        const blocked = await this.pool.query(
          `SELECT 1 FROM xcf_user_blocks
           WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
          [followerId, followingId],
        );
        if (blocked.rows[0]) continue;
        const res = await this.pool.query(
          `INSERT INTO xcf_user_follows (id, follower_id, following_id, created_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), followerId, followingId, follow.createdAt ?? new Date()],
        );
        if (res.rowCount) this.bump("follows");
      } catch (err) {
        this.fail("follow", `${follow.followerSourceId}->${follow.followingSourceId}`, (err as Error).message);
      } finally {
        this.reporter.progress("follows", ++done, follows.length);
      }
    }
  }

  async loadPostLikes(likes: Rows<ImportedPostLike>): Promise<void> {
    const total = sizeOf(likes);
    let done = 0;
    for await (const page of pagesOf(likes)) for (const like of page) {
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
      this.reporter.progress("postLikes", ++done, Math.max(total, done));
    }
    if (done < total) this.reporter.progress("postLikes", total, total);
  }

  private async recomputeSocialCounters(): Promise<void> {
    await this.pool.query(`
      UPDATE forum_posts p SET like_count = sub.n
      FROM (SELECT post_id, COUNT(*)::int AS n FROM forum_post_likes GROUP BY post_id) sub
      WHERE p.id = sub.post_id`);
    // Likes received on the user's posts (§38/§45).
    await this.pool.query(`
      UPDATE xcf_users u SET like_count_received = sub.n
      FROM (SELECT p.author_id, COUNT(*)::int AS n
            FROM forum_post_likes l JOIN forum_posts p ON p.id = l.post_id
            WHERE p.deleted_at IS NULL GROUP BY p.author_id) sub
      WHERE u.id = sub.author_id`);
    await this.pool.query(`
      UPDATE xcf_users u SET follower_count = COALESCE(sub.n, 0)
      FROM (SELECT following_id, COUNT(*)::int AS n FROM xcf_user_follows GROUP BY following_id) sub
      WHERE u.id = sub.following_id`);
    await this.pool.query(`
      UPDATE xcf_users u SET following_count = COALESCE(sub.n, 0)
      FROM (SELECT follower_id, COUNT(*)::int AS n FROM xcf_user_follows GROUP BY follower_id) sub
      WHERE u.id = sub.follower_id`);
  }

  // ── denormalized counters (§38/§46) ───────────────────────────────────────

  async recomputeCounters(): Promise<void> {
    await this.pool.query(`
      UPDATE xcf_articles a SET comment_count = sub.n
      FROM (SELECT article_id, COUNT(*)::int AS n
            FROM xcf_article_comments WHERE deleted_at IS NULL GROUP BY article_id) sub
      WHERE a.id = sub.article_id`);
    await this.pool.query(`
      UPDATE xcf_users u SET article_count = sub.n
      FROM (SELECT author_id, COUNT(*)::int AS n
            FROM xcf_articles WHERE deleted_at IS NULL AND status = 'published'
            GROUP BY author_id) sub
      WHERE u.id = sub.author_id`);
  }

  // ── subscriptions, bans, profile walls ───────────────────────────────────

  /** Thread follows, for threads that came over. Anything else is quietly ignored. */
  async loadSubscriptions(subs: ImportedSubscription[]): Promise<void> {
    for (const sub of subs) {
      const userId = await this.mapped("user", sub.userSourceId);
      const threadId = await this.mapped("thread", sub.threadSourceId);
      if (!userId || !threadId) continue;
      const res = await this.pool.query(
        `INSERT INTO forum_subscriptions (id, user_id, thread_id, notify_type, created_at)
         VALUES ($1, $2, $3, 'reply', $4) ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [crypto.randomUUID(), userId, threadId, sub.createdAt ?? new Date()],
      );
      if (res.rowCount) this.bump("subscriptions");
    }
  }

  /**
   * Bans still in force. Like every ban in Xentium: a moderation ban row plus the
   * account's banned-until date. An imported account has no sessions to end.
   */
  /** Who records an imported ban or warning when its issuer didn't come over. */
  private async firstAdmin(): Promise<string | undefined> {
    const r = await this.pool.query(
      `SELECT u.id FROM xcf_users u JOIN xcf_user_groups ug ON ug."userId" = u.id JOIN xcf_groups g ON g.id = ug."groupId"
        WHERE g.key = 'admin' ORDER BY u."createdAt" LIMIT 1`);
    return (r.rows[0] as { id: string } | undefined)?.id;
  }

  /** Warnings still in force, as active moderation warnings. */
  async loadWarnings(warnings: ImportedWarning[]): Promise<void> {
    const fallback = await this.firstAdmin();
    for (const w of warnings) {
      if (w.expiresAt && w.expiresAt.getTime() <= Date.now()) continue;
      const userId = await this.mapped("user", w.userSourceId);
      if (!userId) continue;
      const issuer = (w.issuedBySourceId && await this.mapped("user", w.issuedBySourceId)) || fallback;
      if (!issuer) { this.fail("warning", w.userSourceId, "no administrator on the target to record it under"); continue; }
      await this.pool.query(
        `INSERT INTO xcf_moderation_warnings (id, user_id, issued_by_id, reason, status, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [crypto.randomUUID(), userId, issuer, w.reason.trim() || "Warning from the previous site", w.expiresAt, w.createdAt ?? new Date()],
      );
      this.bump("warnings");
    }
  }

  async loadBans(bans: ImportedBan[]): Promise<void> {
    const fallback = { id: await this.firstAdmin() };
    for (const ban of bans) {
      if (ban.expiresAt && ban.expiresAt.getTime() <= Date.now()) continue;
      const userId = await this.mapped("user", ban.userSourceId);
      if (!userId) continue;
      const issuer = (ban.issuedBySourceId && await this.mapped("user", ban.issuedBySourceId)) || fallback?.id;
      if (!issuer) { this.fail("ban", ban.userSourceId, "no administrator on the target to record it under"); continue; }
      const active = await this.pool.query(`SELECT 1 FROM xcf_moderation_bans WHERE user_id = $1 AND status = 'active'`, [userId]);
      if (active.rows[0]) continue;
      await this.pool.query(
        `INSERT INTO xcf_moderation_bans (id, user_id, issued_by_id, type, reason, status, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)`,
        [crypto.randomUUID(), userId, issuer, ban.expiresAt ? "temporary" : "permanent",
         ban.reason.trim() || "Banned on the previous site", ban.expiresAt, ban.createdAt ?? new Date()],
      );
      await this.pool.query(`UPDATE xcf_users SET banned_until = $2 WHERE id = $1`,
        [userId, ban.expiresAt ?? new Date("9999-12-31")]);
      this.bump("bans");
    }
  }

  /** Profile wall posts, then their replies (a reply needs its parent first). */
  async loadProfileComments(comments: ImportedProfileComment[]): Promise<void> {
    const ordered = [...comments.filter((c) => !c.parentSourceId), ...comments.filter((c) => c.parentSourceId)];
    for (const c of ordered) {
      try {
        if (await this.mapped("profile_comment", c.sourceId)) continue;
        const profileId = await this.mapped("user", c.profileUserSourceId);
        const authorId = await this.mapped("user", c.authorSourceId);
        if (!profileId || !authorId) throw new Error("its profile owner or author was not imported");
        const parentId = c.parentSourceId ? await this.mapped("profile_comment", c.parentSourceId) : null;
        if (c.parentSourceId && !parentId) throw new Error("the post it replies to was not imported");
        const id = crypto.randomUUID();
        await this.pool.query(
          `INSERT INTO xcf_profile_comments (id, profile_user_id, author_id, body, parent_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, profileId, authorId, sanitizeImportedPost(c.bodyHtml), parentId, c.createdAt ?? new Date()],
        );
        await this.remember("profile_comment", c.sourceId, id);
        this.bump("profileComments");
      } catch (err) {
        this.fail("profile_comment", c.sourceId, (err as Error).message);
      }
    }
  }

  // ── private conversations (xentium-messaging) ────────────────────────────

  /**
   * Conversations and their messages, into the messaging plugin's tables. Each one
   * goes to its own participants only. Imported conversations count as read: an
   * import must not hand every member hundreds of "unread" letters from years ago.
   */
  async loadConversations(conversations: ImportedConversation[], messages: Rows<ImportedMessage>): Promise<void> {
    let done = 0;
    for (const c of conversations) {
      try {
        await this.loadConversation(c);
      } catch (err) {
        this.fail("conversation", c.sourceId, (err as Error).message);
      }
      this.reporter.progress("conversations", ++done, conversations.length);
    }
    done = 0;
    const total = sizeOf(messages);
    for await (const page of pagesOf(messages)) {
      const already = await this.mappedAmong("message", page.map((m) => m.sourceId));
      for (const m of page) {
        try {
          if (!already.has(m.sourceId)) await this.loadMessage(m);
        } catch (err) {
          this.fail("message", m.sourceId, (err as Error).message);
        }
        this.reporter.progress("messages", ++done, Math.max(total, done));
      }
    }
    if (done < total) this.reporter.progress("messages", total, total);
    // Last message time, and "read up to the last message" for everyone in it.
    await this.pool.query(`
      UPDATE pm_conversations c SET last_message_at = sub.last
        FROM (SELECT conversation_id, MAX(created_at) AS last FROM pm_messages GROUP BY conversation_id) sub
       WHERE c.id = sub.conversation_id AND c.last_message_at IS NULL`);
    await this.pool.query(`
      UPDATE pm_participants p SET last_read_at = c.last_message_at
        FROM pm_conversations c
       WHERE c.id = p.conversation_id AND p.last_read_at IS NULL AND c.last_message_at IS NOT NULL
         AND c.id IN (SELECT xentium_id FROM xcf_import_map WHERE platform = $1 AND entity = 'conversation')`, [this.platform]);
  }

  private async loadConversation(c: ImportedConversation): Promise<void> {
    if (await this.mapped("conversation", c.sourceId)) return;
    const starterId = await this.mapped("user", c.starterSourceId);
    if (!starterId) throw new Error(`starter "${c.starterSourceId}" was not imported`);
    const people: Array<{ id: string; left?: boolean; archived?: boolean }> = [];
    for (const p of c.participants) {
      const id = await this.mapped("user", p.userSourceId);
      if (id && !people.some((x) => x.id === id)) people.push({ id, left: p.left, archived: p.archived });
    }
    if (!people.some((p) => p.id === starterId)) people.unshift({ id: starterId });
    if (people.length < 2) throw new Error("fewer than two participants were imported");

    const id = crypto.randomUUID();
    const created = c.createdAt ?? new Date();
    await this.pool.query(
      `INSERT INTO pm_conversations (id, is_group, title, created_by, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, people.length > 2, c.title?.trim() || null, starterId, created],
    );
    for (const p of people) {
      await this.pool.query(
        `INSERT INTO pm_participants (id, conversation_id, user_id, is_archived, left_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [crypto.randomUUID(), id, p.id, !!p.archived, p.left ? created : null, created],
      );
    }
    await this.remember("conversation", c.sourceId, id);
    this.bump("conversations");
  }

  private async loadMessage(m: ImportedMessage): Promise<void> {
    const conversationId = await this.mapped("conversation", m.conversationSourceId);
    if (!conversationId) throw new Error(`conversation "${m.conversationSourceId}" was not imported`);
    const senderId = await this.mapped("user", m.senderSourceId);
    if (!senderId) throw new Error(`sender "${m.senderSourceId}" was not imported`);
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO pm_messages (id, conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, conversationId, senderId, sanitizeImportedPost(m.bodyHtml), m.createdAt ?? new Date()],
    );
    await this.remember("message", m.sourceId, id);
    this.bump("messages");
  }

  /** Run everything in dependency order. */
  async loadAll(extract: ExtractResult, requiredPlugins: string[] = []): Promise<void> {
    await this.assertTargetReady(requiredPlugins);
    if (extract.groups?.length) {
      this.reporter.info(`Importing ${extract.groups.length} member groups (no permissions; grant them in ACP → Users → Groups)…`);
      await this.loadGroups(extract.groups);
    }
    this.reporter.info(`Importing ${extract.users.length} users…`);
    await this.loadUsers(extract.users);
    this.reporter.info(`Importing ${extract.categories.length} categories…`);
    await this.loadCategories(extract.categories);
    this.reporter.info(`Importing ${extract.articles.length} articles…`);
    await this.loadArticles(extract.articles);
    this.reporter.info(`Importing ${extract.comments.length} comments…`);
    await this.loadComments(extract.comments);
    if (extract.forumNodes?.length || extract.threads?.length || sizeOf(extract.posts)) {
      this.reporter.info(`Importing ${extract.forumNodes?.length ?? 0} forum nodes…`);
      await this.loadForumNodes(extract.forumNodes ?? []);
      if (extract.prefixes?.length) {
        this.reporter.info(`Importing ${extract.prefixes.length} thread prefixes…`);
        await this.loadPrefixes(extract.prefixes);
      }
      this.reporter.info(`Importing ${extract.threads?.length ?? 0} threads…`);
      await this.loadThreads(extract.threads ?? []);
      this.reporter.info(`Importing ${sizeOf(extract.posts)} posts…`);
      await this.loadPosts(extract.posts ?? []);
      this.reporter.info("Recomputing forum counters…");
      await this.recomputeForumCounters();
    }
    if (extract.subscriptions?.length) {
      this.reporter.info(`Importing thread subscriptions…`);
      await this.loadSubscriptions(extract.subscriptions);
    }
    if (extract.bans?.length) {
      this.reporter.info(`Importing bans that are still in force…`);
      await this.loadBans(extract.bans);
    }
    if (extract.warnings?.length) {
      this.reporter.info(`Importing warnings that are still in force…`);
      await this.loadWarnings(extract.warnings);
    }
    if (extract.profileComments?.length) {
      this.reporter.info(`Importing ${extract.profileComments.length} profile wall posts…`);
      await this.loadProfileComments(extract.profileComments);
    }
    if (extract.blocks?.length || extract.follows?.length || sizeOf(extract.postLikes)) {
      this.reporter.info(`Importing social graph (${extract.blocks?.length ?? 0} blocks, ${extract.follows?.length ?? 0} follows, ${sizeOf(extract.postLikes)} post likes)…`);
      await this.loadBlocks(extract.blocks ?? []);
      await this.loadFollows(extract.follows ?? []);
      await this.loadPostLikes(extract.postLikes ?? []);
      this.reporter.info("Recomputing social counters…");
      await this.recomputeSocialCounters();
    }
    if (extract.conversations?.length) {
      // Optional: a site without the messaging plugin still gets everything else.
      if ((await missingPlugins(this.pool, [MESSAGING_PLUGIN])).length) {
        this.reporter.warn(
          `${extract.conversations.length} private conversation(s) not imported: the "${MESSAGING_PLUGIN}" plugin isn't enabled on the target. ` +
          `Enable it and run the migration again to bring them over (everything else is skipped as already imported).`,
        );
        for (const c of extract.conversations) {
          this.errors.push({ entity: "conversation", sourceId: c.sourceId, reason: "messaging plugin not enabled on the target" });
        }
      } else {
        this.reporter.info(`Importing ${extract.conversations.length} private conversations (${sizeOf(extract.messages)} messages)…`);
        await this.loadConversations(extract.conversations, extract.messages ?? []);
      }
    }
    if (this.avatarsWithoutUploads) {
      this.reporter.warn(`${this.avatarsWithoutUploads} avatar(s) not copied: pass --uploads <Xentium's upload folder> and run again to bring them over.`);
    }
    this.reporter.info("Recomputing denormalized counters…");
    await this.recomputeCounters();
  }
}

/** The image type from its first bytes (the same check uploads use), or null. */
export function imageType(data: Buffer): "jpg" | "png" | "gif" | "webp" | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Thread tags as the forum stores them: trimmed, de-duplicated, at most 10 of up to 40 characters. */
export function cleanTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const tag = t.trim().slice(0, 40);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length === 10) break;
  }
  return out;
}

/** Private conversations land in this plugin's tables, when it's enabled. */
export const MESSAGING_PLUGIN = "xentium-messaging";

/** Which of `required` plugin ids are NOT enabled on the target. */
export async function missingPlugins(pool: pg.Pool, required: string[]): Promise<string[]> {
  if (!required.length) return [];
  const res = await pool
    .query(`SELECT id FROM xcf_installed_plugins WHERE status = 'enabled' AND id = ANY($1)`, [required])
    .catch(() => ({ rows: [] as Array<{ id: string }> }));
  const enabled = new Set(res.rows.map((r) => r.id));
  return required.filter((id) => !enabled.has(id));
}
