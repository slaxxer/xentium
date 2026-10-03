/**
 * What a report is about: the content's author, its text and where it lives.
 * Shared by filing (to record it) and the ModCanvas inspector (to show it).
 */
import { prisma } from "../../infrastructure/db.js";
import { reportTargetRegistry } from "../../core/report-target-registry/report-target-registry.js";

// ── What a report is about ───────────────────────────────────────────────────

export interface TargetInfo {
  authorId: string | null;
  /** The content's text, plain. */
  snapshot: string | null;
  /** Where it lives: an article title, "mara's profile". */
  where: string | null;
  href: string | null;
}

const NONE: TargetInfo = { authorId: null, snapshot: null, where: null, href: null };
const SNAPSHOT_MAX = 2000;

/** Rich text to a readable line: tags out, the common entities back, whitespace collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|blockquote|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNAPSHOT_MAX);
}

/**
 * Who wrote a piece of core content, what it said, and where it is.
 *
 * ⚠ A report used to carry none of this for core content — the author and the
 * snapshot columns existed and nothing filled them — so the canvas could not offer
 * Warn or Ban on an article comment at all. Plugin content resolves to nothing here;
 * a plugin that files reports supplies its own.
 */
export async function describeTarget(targetType: string, targetId: string): Promise<TargetInfo> {
  try {
    if (targetType === "article") {
      const a = await prisma.article.findUnique({
        where: { id: targetId }, select: { title: true, slug: true, authorId: true, bodyPlain: true },
      });
      if (!a) return NONE;
      return { authorId: a.authorId, snapshot: a.bodyPlain ? plainText(a.bodyPlain) : null, where: a.title, href: `/articles/${a.slug}` };
    }
    if (targetType === "article_comment") {
      const c = await prisma.articleComment.findUnique({
        where: { id: targetId }, select: { authorId: true, body: true, article: { select: { title: true, slug: true } } },
      });
      if (!c) return NONE;
      return { authorId: c.authorId, snapshot: plainText(c.body), where: c.article.title, href: `/articles/${c.article.slug}` };
    }
    if (targetType === "profile_comment") {
      const c = await prisma.profileComment.findUnique({
        where: { id: targetId }, select: { authorId: true, body: true, profileUser: { select: { username: true } } },
      });
      if (!c) return NONE;
      return { authorId: c.authorId, snapshot: plainText(c.body), where: `${c.profileUser.username}'s profile`, href: `/u/${c.profileUser.username}` };
    }
    if (targetType === "user") {
      const u = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, username: true, bio: true } });
      if (!u) return NONE;
      return { authorId: u.id, snapshot: u.bio ? plainText(u.bio) : null, where: `${u.username}'s profile`, href: `/u/${u.username}` };
    }
    if (targetType === "plugin-content") {
      // The plugin describes its own content (`ctx.registerReportTarget`); core never
      // reads plugin tables. A disabled plugin's content resolves to nothing.
      const target = reportTargetRegistry.resolve(targetId);
      const info = target ? await target.handler.describe(target.id) : null;
      if (!info) return NONE;
      return {
        authorId: info.authorId,
        snapshot: info.snapshot ? plainText(info.snapshot) : null,
        where: info.where,
        // Site-relative only: a plugin's link is followed by the moderator's browser.
        href: info.href && info.href.startsWith("/") && !info.href.startsWith("//") ? info.href : null,
      };
    }
  } catch { /* deleted or malformed — the report still shows */ }
  return NONE;
}

/** Content core can remove from a report: its own kinds, or a plugin's that offers it. */
export function canRemoveTarget(targetType: string, targetId: string): boolean {
  if (targetType === "article" || targetType === "article_comment" || targetType === "profile_comment") return true;
  if (targetType === "plugin-content") return !!reportTargetRegistry.resolve(targetId)?.handler.remove;
  return false;
}
