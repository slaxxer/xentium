import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { buildPaginationMeta, type PaginatedResponse } from "@nodevo/contracts";

export interface ActivityEntry {
  category: "page_visit" | "acp_action";
  userId?: string | null;
  username?: string | null;
  method?: string | null;
  path: string;
  status?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Prisma.InputJsonValue;
}

export interface ActivityRow {
  id: string;
  category: string;
  userId: string | null;
  username: string | null;
  method: string | null;
  path: string;
  status: number | null;
  ip: string | null;
  createdAt: Date;
}

export const activityService = {
  /** Fire-and-forget — logging must never break a request. */
  log(entry: ActivityEntry): void {
    prisma.activityLog
      .create({
        data: {
          category: entry.category,
          userId: entry.userId ?? null,
          username: entry.username ?? null,
          method: entry.method ?? null,
          path: entry.path.slice(0, 500),
          status: entry.status ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
        },
      })
      .catch(() => { /* swallow — telemetry is best-effort */ });
  },

  /** True if this user has a page_visit to `path` at or after `since`. Backs the
   *  update dialog's "has the admin actually been to the Updates page?" check —
   *  ACP movements are logged as page_visit, so a visit is a real, per-user,
   *  device-independent acknowledgement (unlike a dismissed dialog). */
  async hasVisitedSince(userId: string, path: string, since: Date): Promise<boolean> {
    const row = await prisma.activityLog.findFirst({
      where: { category: "page_visit", userId, path, createdAt: { gte: since } },
      select: { id: true },
    });
    return !!row;
  },

  async list(opts: { page: number; limit: number; category?: string }): Promise<PaginatedResponse<ActivityRow>> {
    const where: Prisma.ActivityLogWhereInput = opts.category ? { category: opts.category } : {};
    const [data, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        select: {
          id: true, category: true, userId: true, username: true,
          method: true, path: true, status: true, ip: true, createdAt: true,
        },
      }),
      prisma.activityLog.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total }) };
  },
};
