import { LEGAL_DOCUMENTS, type LegalDocumentKey, type PageInfo, type PageSource } from "@xentium/contracts";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../../shared/utils/settings.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { serverText, toServerLocale, type ServerLocale } from "../../shared/i18n/serverText.js";
import { seoRegistry } from "./seo.registry.js";

/**
 * Core's own pages, described the way a guest may see them. Anything a guest
 * can't open (members-only, hidden, unpublished, a deactivated account) answers
 * null and is left out of the sitemap.
 */

async function siteLocale(): Promise<ServerLocale> {
  return toServerLocale(await getSetting<string>("site.locale", "en")) ?? "en";
}

/** A summary for previews: plain text, one line, at most ~200 characters. */
export function summarize(text: string | null | undefined, max = 200): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

const uploadPath = (p: string | null | undefined) => (p ? (p.startsWith("/") || /^https?:/.test(p) ? p : `/uploads/${p}`) : null);

/** Published, not hidden, public, in no category or a public one. */
const publicArticle = {
  status: "published", deletedAt: null, hiddenAt: null, visibility: "public",
  OR: [{ categoryId: null }, { category: { effectiveVisibility: "public" } }],
} satisfies Prisma.ArticleWhereInput;

const home: PageSource = {
  id: "core.home", area: "pages", label: "Home",
  async describe(path) {
    if (path !== "/") return null;
    const [name, description] = await Promise.all([getSetting<string>("site.name", "Xentium"), getSetting<string>("site.description", "")]);
    return { path: "/", kind: "home", area: "pages", title: name, description: description || null };
  },
  async list() { return [{ path: "/" }]; },
};

const pages: PageSource = {
  id: "core.pages", area: "pages", label: "Article index and member list",
  async describe(path) {
    const locale = await siteLocale();
    const home = { name: serverText(locale, "seo", "home"), path: "/" };
    if (path === "/articles") {
      const t = serverText(locale, "seo", "articles");
      return { path, kind: "page", area: "articles", title: t, breadcrumbs: [home, { name: t, path }] };
    }
    if (path === "/members") {
      const t = serverText(locale, "seo", "members");
      return { path, kind: "page", area: "members", title: t, breadcrumbs: [home, { name: t, path }] };
    }
    return null;
  },
  async list() {
    const latest = await prisma.article.findFirst({ where: publicArticle, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    return [{ path: "/articles", lastmod: latest?.updatedAt.toISOString() ?? null }, { path: "/members" }];
  },
};

const articles: PageSource = {
  id: "core.articles", area: "articles", label: "Articles",
  async describe(path) {
    const m = /^\/articles\/([^/]+)$/.exec(path);
    if (!m || m[1] === "new") return null;
    const a = await prisma.article.findFirst({
      where: { ...publicArticle, slug: decodeURIComponent(m[1]!) },
      select: {
        id: true, title: true, slug: true, excerpt: true, bodyPlain: true, featuredImage: true, publishedAt: true, updatedAt: true,
        author: { select: { username: true, displayName: true } }, category: { select: { name: true } },
      },
    });
    if (!a) return null;
    const locale = await siteLocale();
    const index = serverText(locale, "seo", "articles");
    const info: PageInfo = {
      path, kind: "article", id: a.id, area: "articles", title: a.title,
      description: summarize(a.excerpt) ?? summarize(a.bodyPlain),
      image: uploadPath(a.featuredImage), imageAlt: a.title,
      author: { name: a.author.displayName || a.author.username, path: `/u/${encodeURIComponent(a.author.username)}` },
      publishedAt: a.publishedAt?.toISOString() ?? null, modifiedAt: a.updatedAt.toISOString(),
      breadcrumbs: [{ name: serverText(locale, "seo", "home"), path: "/" }, { name: index, path: "/articles" }, { name: a.title, path }],
      data: { category: a.category?.name ?? null },
    };
    return info;
  },
  async list() {
    const rows = await prisma.article.findMany({ where: publicArticle, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" } });
    return rows.map((r) => ({ path: `/articles/${encodeURIComponent(r.slug)}`, lastmod: r.updatedAt.toISOString() }));
  },
};

/** Active and not banned right now (a ban has a date; permanent ones are far in the future). */
const activeUser = () => ({ isActive: true, OR: [{ bannedUntil: null }, { bannedUntil: { lt: new Date() } }] });

const profiles: PageSource = {
  id: "core.profiles", area: "profiles", label: "Member profiles",
  async describe(path) {
    const m = /^\/u\/([^/]+)$/.exec(path);
    if (!m) return null;
    const u = await prisma.user.findFirst({
      where: { ...activeUser(), username: { equals: decodeURIComponent(m[1]!), mode: "insensitive" } },
      select: { id: true, username: true, displayName: true, bio: true, avatar: true, createdAt: true },
    });
    if (!u) return null;
    const locale = await siteLocale();
    return {
      path: `/u/${encodeURIComponent(u.username)}`, kind: "profile", id: u.id, area: "profiles",
      title: u.displayName || u.username, description: summarize(u.bio), image: resolveAvatar(u.avatar), imageAlt: u.username,
      breadcrumbs: [{ name: serverText(locale, "seo", "home"), path: "/" }, { name: serverText(locale, "seo", "members"), path: "/members" }, { name: u.displayName || u.username, path: `/u/${encodeURIComponent(u.username)}` }],
      data: { username: u.username },
    };
  },
  async list() {
    const rows = await prisma.user.findMany({ where: activeUser(), select: { username: true, updatedAt: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ path: `/u/${encodeURIComponent(r.username)}`, lastmod: r.updatedAt.toISOString() }));
  },
};

const legal: PageSource = {
  id: "core.legal", area: "legal", label: "Legal pages",
  async describe(path) {
    const m = /^\/legal\/([a-z]+)$/.exec(path);
    if (!m || !(LEGAL_DOCUMENTS as readonly string[]).includes(m[1]!)) return null;
    const key = m[1] as LegalDocumentKey;
    const doc = await prisma.legalDocument.findUnique({ where: { key }, select: { publishedAt: true, body: true } });
    if (!doc?.publishedAt || doc.body === null) return null;
    const locale = await siteLocale();
    return { path, kind: "legal", area: "legal", title: serverText(locale, "seo", `legal.${key}`), modifiedAt: doc.publishedAt.toISOString() };
  },
  async list() {
    const rows = await prisma.legalDocument.findMany({ where: { publishedAt: { not: null }, body: { not: Prisma.AnyNull } }, select: { key: true, publishedAt: true } });
    return rows.map((r) => ({ path: `/legal/${r.key}`, lastmod: r.publishedAt!.toISOString() }));
  },
};

export function registerCoreSources(): void {
  for (const s of [home, pages, articles, profiles, legal]) seoRegistry.registerSource(s, "core");
}
