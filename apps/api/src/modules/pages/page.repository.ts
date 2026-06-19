import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";

export const pageInclude = {
  _count: { select: { navItems: { where: { isActive: true } } } },
  // A page has at most one nav link — its placement (if any) drives the editor.
  navItems: { select: { placement: true }, take: 1 },
} satisfies Prisma.PageInclude;

export type PageWithIncludes = Prisma.PageGetPayload<{
  include: typeof pageInclude;
}>;

export const pageRepository = {
  async slugExists(slug: string): Promise<boolean> {
    const found = await prisma.page.findUnique({ where: { slug }, select: { id: true } });
    return found !== null;
  },

  async findById(id: string) {
    return prisma.page.findUnique({ where: { id }, include: pageInclude });
  },

  async findBySlug(slug: string) {
    return prisma.page.findUnique({ where: { slug }, include: pageInclude });
  },

  async list(opts: { page: number; limit: number; status?: string; q?: string }) {
    const where: Prisma.PageWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.page.findMany({
        where,
        include: pageInclude,
        orderBy: { updatedAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.page.count({ where }),
    ]);
    return { data, total };
  },
};
