import type { HeadTags, MetaTag, PageInfo } from "@xentium/contracts";
import { getSettings } from "../../shared/utils/settings.js";
import { seoRegistry } from "./seo.registry.js";

/**
 * Turning an address into what search engines and link previews read: the page's
 * description (from whichever source owns it), then the tags. The SEO plugin, when
 * enabled, decides the tags; otherwise core writes plain defaults from the
 * description and the site settings. The served page and `GET /api/site/head`
 * (the app, on every navigation) both come through here, so they always agree.
 */

/** `/articles/x/` → `/articles/x`; anything odd → `/`. */
export function cleanPath(raw: string): string {
  let p = (raw || "/").split("?")[0]!.split("#")[0]!;
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.length > 512 ? "/" : p;
}

export async function describe(path: string): Promise<PageInfo | null> {
  for (const source of seoRegistry.sources()) {
    if (!source.describe) continue;
    try {
      const info = await source.describe(path);
      if (info) return info;
    } catch {
      /* one broken source never takes the page down */
    }
  }
  return null;
}

/** An absolute URL on this site; null when the site address isn't set (or is broken). */
export function absolute(base: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return null;
  try { return new URL(path, `${base.replace(/\/+$/, "")}/`).toString(); } catch { return null; }
}

/** What core writes without an SEO plugin. */
export async function defaults(path: string, info: PageInfo | null): Promise<HeadTags> {
  const s = await getSettings({ "site.url": "", "site.name": "Xentium", "site.description": "" });
  const base = String(s["site.url"] ?? "").replace(/\/+$/, "");
  const siteName = String(s["site.name"] || "Xentium");
  const title = !info || info.kind === "home" ? siteName : `${info.title} · ${siteName}`;
  const description = info?.description || String(s["site.description"] || "") || null;
  const canonical = absolute(base, info?.path ?? path);
  const image = absolute(base, info?.image ?? null);
  const meta: MetaTag[] = [
    { property: "og:site_name", content: siteName },
    { property: "og:title", content: info && info.kind !== "home" ? info.title : siteName },
    { property: "og:type", content: info?.kind === "article" ? "article" : info?.kind === "profile" ? "profile" : "website" },
    ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    ...(description ? [{ property: "og:description", content: description }] : []),
    ...(image ? [{ property: "og:image", content: image }] : []),
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
  ];
  return { title, description, canonical, robots: null, meta };
}

/** The tags for a path: the provider's, or core's defaults. */
export async function headFor(rawPath: string): Promise<HeadTags> {
  const path = cleanPath(rawPath);
  const info = await describe(path);
  const base = await defaults(path, info);
  const provider = seoRegistry.provider();
  if (!provider) return base;
  try {
    return await provider.head(path, info, base);
  } catch {
    return base; // a failing plugin never breaks the page's head
  }
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tags as HTML for the served page. JSON-LD is escaped so it can't close its script. */
export function renderHead(tags: HeadTags): string {
  const lines = [`<title>${esc(tags.title)}</title>`];
  if (tags.description) lines.push(`<meta name="description" content="${esc(tags.description)}" />`);
  if (tags.robots) lines.push(`<meta name="robots" content="${esc(tags.robots)}" />`);
  if (tags.canonical) lines.push(`<link rel="canonical" href="${esc(tags.canonical)}" />`);
  for (const m of tags.meta) {
    const key = m.property ? `property="${esc(m.property)}"` : `name="${esc(m.name ?? "")}"`;
    lines.push(`<meta ${key} content="${esc(m.content)}" />`);
  }
  for (const ld of tags.jsonLd ?? []) {
    lines.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
  }
  return lines.join("\n    ");
}

/** robots.txt: core's is short; the provider may write its own. */
export async function robots(): Promise<string> {
  const s = await getSettings({ "site.url": "" });
  const base = String(s["site.url"] ?? "").replace(/\/+$/, "");
  const provider = seoRegistry.provider();
  const core = [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /account",
    "Disallow: /search",
    ...(provider?.sitemap && base ? ["", `Sitemap: ${base}/sitemap.xml`] : []),
  ].join("\n");
  if (!provider?.robots) return `${core}\n`;
  try { return `${(await provider.robots(core)).trimEnd()}\n`; } catch { return `${core}\n`; }
}

/** A sitemap file by name, or null (no provider, or a name it doesn't know). */
export async function sitemap(name: string): Promise<string | null> {
  const provider = seoRegistry.provider();
  if (!provider?.sitemap) return null;
  try { return await provider.sitemap(name); } catch { return null; }
}
