import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "@nodevo/contracts";
import {
  slugify,
  uniqueSlug,
  resolveEffectiveVisibility,
  userCanSeeNode,
  type ViewerContext,
  type VisibilityMode,
  type VisibilityNode,
} from "@nodevo/sdk";
import type { CreateCategoryInput, UpdateCategoryInput, ReorderInput } from "./article-category.validation.js";

type CategoryRow = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  visibility: string;
  visibilityGroups: string[];
  visibilityMinLevel: number | null;
  hideIfNoAccess: boolean;
  effectiveVisibility: string;
};

export interface CategoryTreeNode extends CategoryRow {
  children: CategoryTreeNode[];
}

function toVisibilityNode(row: Pick<CategoryRow, "visibility" | "visibilityGroups" | "visibilityMinLevel">): VisibilityNode {
  return {
    visibility: row.visibility as VisibilityMode,
    visibilityGroups: row.visibilityGroups,
    visibilityMinLevel: row.visibilityMinLevel,
  };
}

function buildTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  const roots: CategoryTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Recompute effective_visibility for the given node and its descendants. */
async function recomputeEffective(
  tx: Prisma.TransactionClient,
  rootId: string,
  parentEffective: VisibilityNode | null,
): Promise<void> {
  const node = await tx.articleCategory.findUnique({ where: { id: rootId } });
  if (!node) return;

  const ownVis = toVisibilityNode(node);
  const effective = parentEffective ? resolveEffectiveVisibility(parentEffective, ownVis) : ownVis;

  await tx.articleCategory.update({
    where: { id: rootId },
    data: { effectiveVisibility: effective.visibility },
  });

  const children = await tx.articleCategory.findMany({
    where: { parentId: rootId },
    select: { id: true },
  });
  for (const c of children) {
    await recomputeEffective(tx, c.id, effective);
  }
}

async function getAncestorEffective(
  tx: Prisma.TransactionClient,
  parentId: string | null | undefined,
): Promise<VisibilityNode | null> {
  if (!parentId) return null;
  const parent = await tx.articleCategory.findUnique({ where: { id: parentId } });
  if (!parent) return null;
  return toVisibilityNode({
    visibility: parent.effectiveVisibility,
    visibilityGroups: parent.visibilityGroups,
    visibilityMinLevel: parent.visibilityMinLevel,
  });
}

export const articleCategoryService = {
  async tree(viewer: ViewerContext | null): Promise<CategoryTreeNode[]> {
    const all = await prisma.articleCategory.findMany({
      orderBy: [{ parentId: "asc" }, { position: "asc" }],
    });
    const visible = viewer == null ? all : all.filter((row) => {
      const node = toVisibilityNode({
        visibility: row.effectiveVisibility,
        visibilityGroups: row.visibilityGroups,
        visibilityMinLevel: row.visibilityMinLevel,
      });
      if (userCanSeeNode(viewer, node)) return true;
      // hide_if_no_access — when false, ineligible viewers still see the node (locked notice on FE)
      return !row.hideIfNoAccess;
    });
    return buildTree(visible);
  },

  async getById(id: string): Promise<CategoryRow> {
    const row = await prisma.articleCategory.findUnique({ where: { id } });
    if (!row) throw new NodevoError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "Category not found" });
    return row;
  },

  async create(input: CreateCategoryInput): Promise<CategoryRow> {
    const slug = await uniqueSlug(input.name, async (s) => {
      const existing = await prisma.articleCategory.findUnique({ where: { slug: s }, select: { id: true } });
      return existing !== null;
    });

    const created = await prisma.$transaction(async (tx) => {
      const maxPos = await tx.articleCategory.aggregate({
        where: { parentId: input.parentId ?? null },
        _max: { position: true },
      });

      const row = await tx.articleCategory.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          parentId: input.parentId ?? null,
          position: (maxPos._max.position ?? 0) + 1,
          visibility: input.visibility,
          visibilityGroups: input.visibilityGroups,
          visibilityMinLevel: input.visibilityMinLevel ?? null,
          hideIfNoAccess: input.hideIfNoAccess,
          effectiveVisibility: input.visibility,
        },
      });

      const parentEffective = await getAncestorEffective(tx, row.parentId);
      await recomputeEffective(tx, row.id, parentEffective);

      return tx.articleCategory.findUniqueOrThrow({ where: { id: row.id } });
    });

    return created;
  },

  async update(id: string, input: UpdateCategoryInput): Promise<CategoryRow> {
    const existing = await prisma.articleCategory.findUnique({ where: { id } });
    if (!existing) throw new NodevoError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "Category not found" });

    const willChangeName = input.name !== undefined && input.name !== existing.name;
    let nextSlug = existing.slug;
    if (willChangeName && input.name) {
      const desired = slugify(input.name);
      if (desired !== existing.slug) {
        nextSlug = await uniqueSlug(input.name, async (s) => {
          if (s === existing.slug) return false;
          const found = await prisma.articleCategory.findUnique({ where: { slug: s }, select: { id: true } });
          return found !== null;
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.articleCategory.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name, slug: nextSlug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...(input.visibilityGroups !== undefined ? { visibilityGroups: input.visibilityGroups } : {}),
          ...(input.visibilityMinLevel !== undefined ? { visibilityMinLevel: input.visibilityMinLevel } : {}),
          ...(input.hideIfNoAccess !== undefined ? { hideIfNoAccess: input.hideIfNoAccess } : {}),
        },
      });

      const fresh = await tx.articleCategory.findUniqueOrThrow({ where: { id } });
      const parentEffective = await getAncestorEffective(tx, fresh.parentId);
      await recomputeEffective(tx, id, parentEffective);

      return tx.articleCategory.findUniqueOrThrow({ where: { id } });
    });

    return updated;
  },

  async remove(id: string, opts: { reparentChildren: boolean }): Promise<void> {
    const existing = await prisma.articleCategory.findUnique({ where: { id } });
    if (!existing) throw new NodevoError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "Category not found" });

    await prisma.$transaction(async (tx) => {
      if (opts.reparentChildren) {
        await tx.articleCategory.updateMany({
          where: { parentId: id },
          data: { parentId: existing.parentId },
        });
      }
      await tx.articleCategory.delete({ where: { id } });

      // Articles with this category get categoryId nulled by FK ON DELETE SET NULL.
      // Re-resolve effective visibility for any reparented children.
      if (opts.reparentChildren && existing.parentId) {
        const moved = await tx.articleCategory.findMany({
          where: { parentId: existing.parentId },
          select: { id: true },
        });
        const parentEffective = await getAncestorEffective(tx, existing.parentId);
        for (const m of moved) await recomputeEffective(tx, m.id, parentEffective);
      }
    });
  },

  async reorder(input: ReorderInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Detect cycles before any write: build the proposed parent map and verify
      // no node ends up as its own ancestor.
      const proposed = new Map<string, string | null>();
      for (const item of input.items) proposed.set(item.id, item.parentId ?? null);

      // Load any nodes outside the input set so we can resolve full ancestor chains
      const existing = await tx.articleCategory.findMany({
        select: { id: true, parentId: true },
      });
      const parentMap = new Map<string, string | null>();
      for (const row of existing) parentMap.set(row.id, row.parentId);
      for (const [id, pid] of proposed) parentMap.set(id, pid);

      for (const id of proposed.keys()) {
        let cursor: string | null = parentMap.get(id) ?? null;
        const seen = new Set<string>([id]);
        while (cursor) {
          if (seen.has(cursor)) {
            throw new NodevoError({
              code: NEC.API_VALIDATION,
              httpStatus: 400,
              message: `Cycle detected at node ${id}`,
            });
          }
          seen.add(cursor);
          cursor = parentMap.get(cursor) ?? null;
        }
      }

      for (const item of input.items) {
        await tx.articleCategory.update({
          where: { id: item.id },
          data: {
            position: item.position,
            // Only update parentId when explicitly provided (reparent); otherwise keep existing
            ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
          },
        });
      }

      for (const item of input.items) {
        const parentEffective = await getAncestorEffective(tx, item.parentId);
        await recomputeEffective(tx, item.id, parentEffective);
      }
    });
  },
};
