/**
 * What search engines read, the core half: only what a guest may open is described,
 * core's defaults without a provider, a provider's tags with one (and core's again
 * when it fails), and nothing in the tags can break out of the page's head.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SeoProvider } from "@xentium/contracts";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { registerCoreSources } = await import("./seo.core-sources.js");
const { seoRegistry } = await import("./seo.registry.js");
const { cleanPath, describe: describePage, headFor, renderHead, robots, sitemap } = await import("./seo.service.js");
const { bustSettingsCache } = await import("../../shared/utils/settings.js");

const P = "seotest";
let authorId = "";

beforeAll(async () => {
  assertDisposableDatabase();
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  authorId = (await prisma.user.create({ data: { email: `${P}@example.test`, username: `${P}_author`, passwordHash: "x" } })).id;
  const art = (slug: string, data: object) => prisma.article.create({
    data: { authorId, title: `T ${slug}`, slug: `${P}-${slug}`, body: { type: "doc", content: [] }, status: "published", publishedAt: new Date(), excerpt: "An excerpt.", ...data },
  });
  await art("public", { featuredImage: "articles/cover.webp" });
  await art("members", { visibility: "members" });
  await art("hidden", { hiddenAt: new Date() });
  await art("draft", { status: "draft" });
  await prisma.setting.upsert({ where: { key: "site.url" }, update: { value: "https://example.test" }, create: { key: "site.url", value: "https://example.test" } });
  await prisma.setting.upsert({ where: { key: "site.name" }, update: { value: "Example" }, create: { key: "site.name", value: "Example" } });
  bustSettingsCache("site.url"); bustSettingsCache("site.name");
  registerCoreSources();
});
afterEach(() => seoRegistry.dropOwner("test-plugin"));
afterAll(async () => {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
});

describe("pages", () => {
  it("cleans paths", () => {
    expect(cleanPath("/articles/x/?a=1#b")).toBe("/articles/x");
    expect(cleanPath("articles")).toBe("/articles");
    expect(cleanPath("")).toBe("/");
  });

  it("describes only what a guest may open", async () => {
    const info = await describePage(`/articles/${P}-public`);
    expect(info).toMatchObject({ kind: "article", area: "articles", title: "T public", description: "An excerpt.", image: "/uploads/articles/cover.webp" });
    expect(info?.author?.name).toBe(`${P}_author`);
    for (const s of ["members", "hidden", "draft", "nope"]) expect(await describePage(`/articles/${P}-${s}`)).toBeNull();
    expect(await describePage(`/u/${P}_author`)).toMatchObject({ kind: "profile", title: `${P}_author` });
  });
});

describe("head", () => {
  it("writes core's defaults without a provider", async () => {
    const h = await headFor(`/articles/${P}-public/`);
    expect(h.title).toBe("T public · Example");
    expect(h.description).toBe("An excerpt.");
    expect(h.canonical).toBe(`https://example.test/articles/${P}-public`);
    expect(h.meta).toContainEqual({ property: "og:image", content: "https://example.test/uploads/articles/cover.webp" });
    expect(h.meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
    expect((await headFor("/no-such-page")).title).toBe("Example");
  });

  it("uses the provider's tags, and core's when it fails", async () => {
    const provider: SeoProvider = { async head(_p, info, d) { return { ...d, title: `[${info?.title}]`, robots: "noindex" }; } };
    seoRegistry.setProvider(provider, "test-plugin");
    expect(await headFor(`/articles/${P}-public`)).toMatchObject({ title: "[T public]", robots: "noindex" });
    seoRegistry.setProvider({ async head() { throw new Error("boom"); } }, "test-plugin");
    expect((await headFor(`/articles/${P}-public`)).title).toBe("T public · Example");
    seoRegistry.dropOwner("test-plugin");
    expect(seoRegistry.provider()).toBeNull();
  });

  it("can't be broken out of", () => {
    const html = renderHead({ title: `</title><script>x</script>`, description: `"><b>`, meta: [{ property: "og:title", content: `"/><script>` }], jsonLd: [{ name: "</script><script>alert(1)</script>" }] });
    expect(html).not.toMatch(/<script>x|<b>|"\/><script>/);
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c/script>");
  });
});

describe("robots and sitemaps", () => {
  it("has robots.txt always, sitemaps only with a provider", async () => {
    expect(await robots()).toContain("Disallow: /admin");
    expect(await robots()).not.toContain("Sitemap:");
    expect(await sitemap("sitemap.xml")).toBeNull();
    seoRegistry.setProvider({ async head(_p, _i, d) { return d; }, async sitemap(n) { return n === "sitemap.xml" ? "<sitemapindex/>" : null; } }, "test-plugin");
    expect(await robots()).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(await sitemap("sitemap.xml")).toBe("<sitemapindex/>");
  });
});
