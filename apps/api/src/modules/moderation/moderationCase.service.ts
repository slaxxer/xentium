import { prisma } from "../../infrastructure/db.js";
import { notificationService } from "../notifications/notification.service.js";

// Shared moderation-case creation used by the core security-analysis job AND by
// plugin security scans (via host.security.createCase). Centralizes the 24h
// dedup window + the "notify everyone with moderation.cases.manage" behaviour so
// plugin-created cases behave identically to core ones.

const WINDOW_24H = 24 * 60 * 60 * 1000;

export async function notifyCaseModerators(): Promise<void> {
  const perm = await prisma.permission.findUnique({ where: { key: "moderation.cases.manage" }, select: { id: true } });
  if (!perm) return;
  const holders = await prisma.userGroup.findMany({
    where:    { group: { permissions: { some: { permissionId: perm.id } } } },
    select:   { userId: true },
    distinct: ["userId"],
  });
  await Promise.all(
    holders.map((h) =>
      notificationService.dispatch({
        userId:   h.userId,
        type:     "mod.new_case",
        title:    "New review case",
        i18n:     { key: "common:notify.newCase" },
        body:     "A suspicious pattern was detected and requires moderator review.",
        link:     "/admin/cases",
        channels: ["in_app"],
      }),
    ),
  );
}

export interface CreateCaseInput {
  type:     string;
  severity: "low" | "medium" | "high";
  signals:  string[];
  userIds:  string[];
}

/** Create a review case unless an open one of the same type already links the
 *  same users within the last 24h (dedup). Notifies case managers on creation. */
export async function createModerationCase(input: CreateCaseInput): Promise<void> {
  const existing = await prisma.moderationCase.findFirst({
    where: {
      type:          input.type,
      status:        "open",
      linkedUserIds: { hasEvery: input.userIds },
      createdAt:     { gte: new Date(Date.now() - WINDOW_24H) },
    },
  });
  if (existing) return;

  await prisma.moderationCase.create({
    data: { type: input.type, severity: input.severity, status: "open", signals: input.signals, linkedUserIds: input.userIds },
  });
  await notifyCaseModerators();
}
