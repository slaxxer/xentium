import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { NEC } from "@nodevo/contracts";
import { buildPaginationMeta, type PaginatedResponse } from "@nodevo/contracts";
import { uniqueSlug } from "@nodevo/sdk";
import { PAGE_SLOTS, pageSlotSettingKey, type PageSlot } from "@nodevo/contracts";
import { pageRepository, pageInclude, type PageWithIncludes } from "./page.repository.js";
import type { CreatePageInput, UpdatePageInput, ListPagesQuery } from "./page.validation.js";
import type { PageDetail, PageListItem } from "./page.types.js";

/** Public URL for a page-backed nav item. Root-level slugs would collide with
 *  app routes, so pages always live under the /p/ namespace. */
export function pagePath(slug: string): string {
  return `/p/${slug}`;
}

function shapeListItem(p: PageWithIncludes): PageListItem {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status as PageListItem["status"],
    visibility: p.visibility as PageListItem["visibility"],
    publishedAt: p.publishedAt,
    inNav: p._count.navItems > 0,
    navPlacement: (p.navItems[0]?.placement as "navbar" | "footer" | undefined) ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function shapeDetail(p: PageWithIncludes): PageDetail {
  return {
    ...shapeListItem(p),
    body: p.body,
    featuredImage: p.featuredImage,
    seoDescription: p.seoDescription,
  };
}

/** Page visibility: public/members only (no node-tree model — §page-system). */
function canViewPage(
  page: { visibility: string; status: string },
  viewerId: string | undefined,
): boolean {
  if (page.status !== "published") return false;
  if (page.visibility === "members") return !!viewerId;
  return true; // public
}

export const pageService = {
  // ── Public ────────────────────────────────────────────────────────────────

  async getBySlug(slug: string, viewerId: string | undefined): Promise<PageDetail> {
    const page = await pageRepository.findBySlug(slug);
    if (!page || !canViewPage(page, viewerId)) {
      throw new XentiumError({
        code: NEC.PAGE_NOT_FOUND,
        httpStatus: 404,
        message: "Page not found",
      });
    }
    return shapeDetail(page);
  },

  // ── Admin ───────────────────────────────────────────────────────────────

  async list(query: ListPagesQuery): Promise<PaginatedResponse<PageListItem>> {
    const { page, limit, status, q } = query;
    const { data, total } = await pageRepository.list({ page, limit, status, q });
    return {
      data: data.map(shapeListItem),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  },

  async getById(id: string): Promise<PageDetail> {
    const page = await pageRepository.findById(id);
    if (!page) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }
    return shapeDetail(page);
  },

  async create(authorId: string, input: CreatePageInput): Promise<PageDetail> {
    const slug = await uniqueSlug(input.title, (s) => pageRepository.slugExists(s));
    const created = await prisma.page.create({
      data: {
        title: input.title,
        slug,
        body: input.body as Prisma.InputJsonValue,
        visibility: input.visibility,
        seoDescription: input.seoDescription,
        createdById: authorId,
      },
      include: pageInclude,
    });
    return shapeDetail(created);
  },

  async update(id: string, input: UpdatePageInput): Promise<PageDetail> {
    const existing = await pageRepository.findById(id);
    if (!existing) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }

    const willChangeTitle = input.title !== undefined && input.title !== existing.title;

    const updated = await prisma.$transaction(async (tx) => {
      let nextSlug = existing.slug;
      if (willChangeTitle && input.title) {
        nextSlug = await uniqueSlug(input.title, async (s) => {
          if (s === existing.slug) return false;
          return pageRepository.slugExists(s);
        });
      }

      const data: Prisma.PageUpdateInput = {
        ...(input.title !== undefined ? { title: input.title, slug: nextSlug } : {}),
        ...(input.body !== undefined ? { body: input.body as Prisma.InputJsonValue } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      };

      await tx.page.update({ where: { id }, data });

      // Keep page-backed nav items pointing at the current slug.
      if (nextSlug !== existing.slug) {
        await tx.navItem.updateMany({ where: { pageId: id }, data: { url: pagePath(nextSlug) } });
      }

      return tx.page.findUniqueOrThrow({ where: { id }, include: pageInclude });
    });

    return shapeDetail(updated);
  },

  async publish(id: string): Promise<PageDetail> {
    const existing = await pageRepository.findById(id);
    if (!existing) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }
    const wasPublished = existing.status === "published";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.page.update({
        where: { id },
        data: { status: "published", ...(wasPublished ? {} : { publishedAt: new Date() }) },
        include: pageInclude,
      });
      // Re-activate any nav items linked to this page now that it's live again.
      await tx.navItem.updateMany({ where: { pageId: id }, data: { isActive: true } });
      return result;
    });
    return shapeDetail(updated);
  },

  async unpublish(id: string): Promise<PageDetail> {
    const existing = await pageRepository.findById(id);
    if (!existing) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.page.update({
        where: { id },
        data: { status: "draft" },
        include: pageInclude,
      });
      // Hide it from the public nav while unpublished (mirrors plugin disable).
      await tx.navItem.updateMany({ where: { pageId: id }, data: { isActive: false } });
      return result;
    });
    return shapeDetail(updated);
  },

  async remove(id: string): Promise<void> {
    const existing = await pageRepository.findById(id);
    if (!existing) return;
    // FK ON DELETE CASCADE removes any page-backed nav items.
    await prisma.page.delete({ where: { id } });
  },

  async setFeaturedImage(id: string, relPath: string): Promise<PageDetail> {
    const existing = await pageRepository.findById(id);
    if (!existing) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }
    const updated = await prisma.page.update({
      where: { id },
      data: { featuredImage: relPath },
      include: pageInclude,
    });
    return shapeDetail(updated);
  },

  // ── Nav coupling (§page-system, "Add to navigation") ──────────────────────

  /** Link this page in the navbar or footer. A page has at most one nav link:
   *  calling again with a different placement moves the existing link. */
  async addToNav(id: string, placement: "navbar" | "footer"): Promise<{ navItemId: string }> {
    const page = await pageRepository.findById(id);
    if (!page) {
      throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
    }
    const existing = await prisma.navItem.findFirst({ where: { pageId: id }, select: { id: true } });
    if (existing) {
      await prisma.navItem.update({ where: { id: existing.id }, data: { placement } });
      return { navItemId: existing.id };
    }

    const max = await prisma.navItem.aggregate({ _max: { position: true } });
    const created = await prisma.navItem.create({
      data: {
        label: page.title,
        url: pagePath(page.slug),
        pageId: page.id,
        placement,
        position: (max._max.position ?? 0) + 1,
        isActive: page.status === "published",
        visibility: page.visibility === "members" ? "members" : "public",
      },
      select: { id: true },
    });
    return { navItemId: created.id };
  },

  /** Remove this page's nav link (navbar or footer), if any. */
  async removeFromNav(id: string): Promise<void> {
    await prisma.navItem.deleteMany({ where: { pageId: id } });
  },

  // ── Slots (§page-system — well-known slots: terms/privacy/imprint/guidelines) ──

  /** ACP view: slot → assigned page id (or null). */
  async getSlotAssignments(): Promise<Record<PageSlot, string | null>> {
    const rows = await prisma.setting.findMany({
      where: { key: { in: PAGE_SLOTS.map(pageSlotSettingKey) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as string | null]));
    return Object.fromEntries(
      PAGE_SLOTS.map((slot) => [slot, byKey.get(pageSlotSettingKey(slot)) ?? null]),
    ) as Record<PageSlot, string | null>;
  },

  /** Assign (or clear, with pageId=null) a page to a slot. */
  async setSlot(slot: PageSlot, pageId: string | null): Promise<void> {
    if (pageId) {
      const exists = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
      if (!exists) {
        throw new XentiumError({ code: NEC.PAGE_NOT_FOUND, httpStatus: 404, message: "Page not found" });
      }
    }
    const key = pageSlotSettingKey(slot);
    const value = pageId ?? Prisma.JsonNull;
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    bustSettingsCache(key);
  },

  /** Public view: slot → { slug, title } for the assigned page, but only when
   *  that page is currently published. Consumers (footer, register) read this. */
  async getPublicSlots(): Promise<Record<PageSlot, { slug: string; title: string } | null>> {
    const assignments = await this.getSlotAssignments();
    const ids = Object.values(assignments).filter((v): v is string => !!v);
    const pages = ids.length
      ? await prisma.page.findMany({
          where: { id: { in: ids }, status: "published" },
          select: { id: true, slug: true, title: true },
        })
      : [];
    const byId = new Map(pages.map((p) => [p.id, { slug: p.slug, title: p.title }]));
    return Object.fromEntries(
      PAGE_SLOTS.map((slot) => {
        const id = assignments[slot];
        return [slot, id ? byId.get(id) ?? null : null];
      }),
    ) as Record<PageSlot, { slug: string; title: string } | null>;
  },
};
