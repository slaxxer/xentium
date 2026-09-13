import { buildPaginationMeta } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";

export const notificationRepository = {
  async create(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string;
    meta?: Record<string, unknown>;
  }) {
    return prisma.notification.create({
      data: {
        userId: data.userId,
        type:   data.type,
        title:  data.title,
        body:   data.body,
        link:   data.link,
        meta:   data.meta as never,
      },
    });
  },

  // Notification types that belong to moderation/admin workflows only.
  // These are kept in the DB (mods receive them) but hidden from the public bell.
  MOD_ONLY_PREFIXES: ["mod.", "security.", "license.", "system."] as const,

  async findForUser(userId: string, opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const _userFilter = {
      userId,
      NOT: { type: { in: [] as string[] } },
    };
    // Exclude mod-only notification types from the public bell
    const prefixFilter = {
      userId,
      AND: notificationRepository.MOD_ONLY_PREFIXES.map((p) => ({
        NOT: { type: { startsWith: p } },
      })),
    };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where:   prefixFilter,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.notification.count({ where: prefixFilter }),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  async countUnread(userId: string): Promise<number> {
    const prefixFilter = {
      userId,
      readAt: null,
      AND: notificationRepository.MOD_ONLY_PREFIXES.map((p) => ({
        NOT: { type: { startsWith: p } },
      })),
    };
    return prisma.notification.count({ where: prefixFilter });
  },

  async markRead(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data:  { readAt: new Date() },
    });
  },

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data:  { readAt: new Date() },
    });
  },

  async findPreferencesForUser(userId: string) {
    return prisma.notificationPreference.findMany({ where: { userId } });
  },

  async upsertPreference(userId: string, typePattern: string, data: {
    inAppEnabled: boolean;
    emailEnabled: boolean;
  }) {
    return prisma.notificationPreference.upsert({
      where:  { userId_typePattern: { userId, typePattern } },
      update: data,
      create: { userId, typePattern, ...data },
    });
  },
};
