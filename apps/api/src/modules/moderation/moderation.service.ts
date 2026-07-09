import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { notificationService } from "../notifications/notification.service.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { DEFAULT_MODERATION_POLICY, humanizeCaseType, describeCaseSignal, type ModerationPolicy, type ReportTargetType } from "./moderation.types.js";

// Shared issuer projection: include the issuer's username + their badge colour.
const issuerSelect = {
  groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
};
const mapIssuer = (i: { id: string; username: string; groups: { group: { progression: { badgeColor: string | null } | null } }[] }) =>
  ({ id: i.id, username: i.username, badgeColor: i.groups[0]?.group.progression?.badgeColor ?? null });

// Find the most recent unresolved case linking a user (used to decide whether a
// ban should alert the mod team). Open + reviewed count; resolved/dismissed don't.
async function findActiveCaseForUser(userId: string) {
  return prisma.moderationCase.findFirst({
    where:   { linkedUserIds: { has: userId }, status: { in: ["open", "reviewed"] } },
    orderBy: { createdAt: "desc" },
    select:  { id: true, type: true },
  });
}

// Alert everyone with `moderation.cases.manage` that a flagged (case-linked)
// account was banned. In-app only (security-alert channel decision). The actor
// who issued the ban is excluded from their own alert.
async function notifyCaseManagersOfBan(username: string, caseType: string | null, excludeUserId: string) {
  const perm = await prisma.permission.findUnique({ where: { key: "moderation.cases.manage" }, select: { id: true } });
  if (!perm) return;
  const holders = await prisma.userGroup.findMany({
    where:    { group: { permissions: { some: { permissionId: perm.id } } } },
    select:   { userId: true },
    distinct: ["userId"],
  });
  const label = caseType ? humanizeCaseType(caseType) : "a review case";
  await Promise.all(
    holders
      .filter((h) => h.userId !== excludeUserId)
      .map((h) => notificationService.dispatch({
        userId:   h.userId,
        type:     "mod.case_user_banned",
        title:    "Flagged account banned",
        body:     `${username} (${label}) was banned.`,
        link:     "/admin/cases",
        channels: ["in_app"],
      })),
  );
}

// Resolve linkedUserIds on case rows to { id, username, badgeColor } objects
async function resolveCaseUsers<T extends { linkedUserIds: string[] }>(rows: T[]) {
  const allIds = [...new Set(rows.flatMap((r) => r.linkedUserIds))];
  if (!allIds.length) return rows.map((r) => ({ ...r, linkedUsers: [] }));

  const users = await prisma.user.findMany({
    where:  { id: { in: allIds } },
    select: {
      id: true, username: true,
      groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
    },
  });
  const map = new Map(users.map((u) => [
    u.id,
    { id: u.id, username: u.username, badgeColor: u.groups[0]?.group.progression?.badgeColor ?? null },
  ]));

  return rows.map((r) => ({
    ...r,
    linkedUsers: r.linkedUserIds.map((id) => map.get(id) ?? { id, username: id, badgeColor: null }),
  }));
}

async function getPolicy(): Promise<ModerationPolicy> {
  const row = await prisma.setting.findUnique({ where: { key: "moderation.policy" } });
  if (!row) return DEFAULT_MODERATION_POLICY;
  return row.value as unknown as ModerationPolicy;
}

async function writeModLog(data: {
  actorId:    string | null;
  actorType:  "user" | "system";
  action:     string;
  targetType?: string | null;
  targetId?:  string | null;
  reason?:    string | null;
  meta?:      Record<string, unknown> | null;
}) {
  await prisma.moderationLog.create({
    data: {
      actorId:    data.actorId,
      actorType:  data.actorType,
      action:     data.action,
      targetType: data.targetType ?? null,
      targetId:   data.targetId ?? null,
      reason:     data.reason ?? null,
      meta:       (data.meta as object | undefined) ?? undefined,
    },
  });
}

// Notify all users with a given permission key
async function notifyPermHolders(permKey: string, opts: {
  type:  string;
  title: string;
  body:  string;
  link?: string;
}) {
  const perm = await prisma.permission.findUnique({ where: { key: permKey }, select: { id: true } });
  if (!perm) return;
  const holders = await prisma.userGroup.findMany({
    where: {
      group: {
        permissions: { some: { permissionId: perm.id } },
      },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  await Promise.all(
    holders.map((h) =>
      notificationService.dispatch({
        userId:   h.userId,
        type:     opts.type,
        title:    opts.title,
        body:     opts.body,
        link:     opts.link,
        channels: ["in_app"],
      }),
    ),
  );
}

export const moderationService = {
  // ── Reports ──────────────────────────────────────────────────────────────

  async fileReport(data: {
    targetType: ReportTargetType;
    targetId:   string;
    reporterId: string;
    reason:     string;
  }) {
    const report = await prisma.moderationReport.create({ data: { ...data, status: "pending" } });

    await notifyPermHolders("moderation.report.manage", {
      type:  "mod.new_report",
      title: "New report filed",
      body:  `A report has been filed for ${data.targetType} content.`,
      link:  "/admin/moderation/reports",
    });

    return report;
  },

  async updateReport(id: string, actorId: string, data: {
    status?:     string;
    notes?:      string;
    assignedTo?: string | null;
  }) {
    const report = await prisma.moderationReport.findUnique({ where: { id } });
    if (!report) throw NodevoError.notFound("Report not found");

    const updated = await prisma.moderationReport.update({
      where: { id },
      data: {
        ...data,
        resolvedAt: data.status && ["resolved", "dismissed"].includes(data.status) ? new Date() : undefined,
        resolvedBy: data.status && ["resolved", "dismissed"].includes(data.status) ? actorId : undefined,
      },
    });

    await writeModLog({
      actorId,
      actorType:  "user",
      action:     `report.${data.status ?? "updated"}`,
      targetType: report.targetType,
      targetId:   report.targetId,
    });

    return updated;
  },

  // ── Warnings ─────────────────────────────────────────────────────────────

  async issueWarning(data: {
    userId:     string;
    issuedById: string;
    reason:     string;
    expiresAt?: Date | null;
  }) {
    const user = await prisma.user.findUnique({
      where:   { id: data.userId },
      include: { groups: { include: { group: { select: { key: true, name: true } } } } },
    });
    if (!user) throw NodevoError.notFound("User not found");
    if (data.userId === data.issuedById) throw NodevoError.forbidden("Cannot warn yourself");

    const STAFF_KEYS = new Set(["admin", "supermod", "moderator"]);
    const staffGroup = user.groups.find((ug) => STAFF_KEYS.has(ug.group.key));
    if (staffGroup) {
      throw NodevoError.forbidden(`You cannot warn a ${staffGroup.group.name} member`);
    }

    const warning = await prisma.moderationWarning.create({
      data: {
        userId:     data.userId,
        issuedById: data.issuedById,
        reason:     data.reason,
        status:     "active",
        expiresAt:  data.expiresAt ?? null,
      },
    });

    await writeModLog({
      actorId:    data.issuedById,
      actorType:  "user",
      action:     "warning.issued",
      targetType: "user",
      targetId:   data.userId,
      reason:     data.reason,
    });

    await notificationService.dispatch({
      userId:   data.userId,
      type:     "moderation.warning_issued",
      title:    "You have received a warning",
      body:     data.reason,
      link:     "/account/security",
      channels: ["in_app", "email"],
    });

    await this.checkThresholds(data.userId, data.issuedById);

    return warning;
  },

  async pardonWarning(id: string, adminId: string) {
    const warning = await prisma.moderationWarning.findUnique({ where: { id } });
    if (!warning) throw NodevoError.notFound("Warning not found");
    if (warning.status !== "active") throw NodevoError.forbidden("Warning is not active");

    await prisma.moderationWarning.update({
      where: { id },
      data:  { status: "pardoned", pardonedAt: new Date(), pardonedBy: adminId },
    });

    await writeModLog({
      actorId:    adminId,
      actorType:  "user",
      action:     "warning.pardoned",
      targetType: "user",
      targetId:   warning.userId,
    });

    await notificationService.dispatch({
      userId:   warning.userId,
      type:     "moderation.warning_pardoned",
      title:    "A warning has been pardoned",
      body:     "One of your warnings has been removed.",
      link:     "/account/security",
      channels: ["in_app"],
    });
  },

  // ── Threshold engine ─────────────────────────────────────────────────────

  async checkThresholds(userId: string, actorId: string) {
    const policy = await getPolicy();
    if (!policy.thresholds.length) return;

    const activeCount = await prisma.moderationWarning.count({
      where: { userId, status: "active" },
    });

    for (const rule of policy.thresholds.sort((a, b) => b.warningCount - a.warningCount)) {
      if (activeCount >= rule.warningCount) {
        if (rule.action === "ban_temporary" && rule.banDays) {
          const expiresAt = new Date(Date.now() + rule.banDays * 86400000);
          await this.autoBan(userId, actorId, "temporary", expiresAt);
        } else if (rule.action === "ban_permanent") {
          await this.autoBan(userId, actorId, "permanent", null);
        }
        break;
      }
    }
  },

  async autoBan(userId: string, triggeredById: string, type: "temporary" | "permanent", expiresAt: Date | null) {
    const alreadyBanned = await prisma.moderationBan.findFirst({
      where: { userId, status: "active" },
    });
    if (alreadyBanned) return;

    const reason = `Automatic ban — warning threshold reached`;
    await prisma.$transaction(async (tx) => {
      await tx.moderationBan.create({
        data: { userId, issuedById: triggeredById, type, reason, status: "active", expiresAt },
      });
      await tx.user.update({
        where: { id: userId },
        data:  { bannedUntil: type === "permanent" ? new Date("9999-12-31") : expiresAt },
      });
      await tx.moderationLog.create({
        data: {
          actorId:    null,
          actorType:  "system",
          action:     "ban.auto_issued",
          targetType: "user",
          targetId:   userId,
          reason,
        },
      });
    });

    await notificationService.dispatch({
      userId,
      type:     "moderation.ban_issued",
      title:    "Your account has been suspended",
      body:     reason,
      channels: ["in_app", "email"],
    });
  },

  // ── Cases ────────────────────────────────────────────────────────────────

  async updateCase(id: string, actorId: string, status: "reviewed" | "dismissed") {
    const existing = await prisma.moderationCase.findUnique({ where: { id } });
    if (!existing) throw NodevoError.notFound("Case not found");

    const updated = await prisma.moderationCase.update({
      where: { id },
      data:  { status, reviewedBy: actorId, reviewedAt: new Date() },
    });

    // When an "Allow Exception" is granted on a multi_account_suspicion case:
    // - Whitelist every device cookie AND IP tied to these accounts
    // - Store the exact set of cleared user IDs so the analysis job can detect
    //   NEW accounts on the same signal and still flag those.
    if (status === "reviewed" && existing.type === "multi_account_suspicion" && existing.linkedUserIds.length > 0) {
      const signalRows = await prisma.loginEvent.findMany({
        where:  { userId: { in: existing.linkedUserIds }, success: true },
        select: { deviceCookieId: true, ip: true },
      });

      const cookies = [...new Set(signalRows.map((r) => r.deviceCookieId).filter(Boolean) as string[])];
      const ips     = [...new Set(signalRows.map((r) => r.ip).filter(Boolean) as string[])];
      const cleared = existing.linkedUserIds;

      const uid = () => `rss_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const upsert = (signalType: string, signalValue: string) =>
        prisma.reviewedSecuritySignal.upsert({
          where:  { signalType_signalValue: { signalType, signalValue } },
          update: { reviewedBy: actorId, reviewedAt: new Date(), caseId: id, clearedUserIds: cleared },
          create: { id: uid(), signalType, signalValue, caseId: id, reviewedBy: actorId, clearedUserIds: cleared },
        });

      for (const cookie of cookies) await upsert("device_cookie", cookie);
      for (const ip     of ips)     await upsert("ip", ip);

      const total = cookies.length + ips.length;
      if (total > 0) {
        await writeModLog({
          actorId,
          actorType:  "user",
          action:     "security.exception_granted",
          targetType: "moderation_case",
          targetId:   id,
          reason:     `Exception granted for ${cleared.length} account(s): ${cookies.length} device cookie(s) + ${ips.length} IP(s) whitelisted. A new account on any of these signals will still trigger a case.`,
        });
      }
    }

    return updated;
  },

  // ── Comment mod-delete ───────────────────────────────────────────────────

  async banCaseUsers(caseId: string, actorId: string) {
    const STAFF_KEYS  = new Set(["admin", "supermod", "moderator"]);
    const BAN_REASON  = "Multi-account policy violation — multiple accounts detected on the same device";

    const existing = await prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!existing) throw NodevoError.notFound("Case not found");

    const users = await prisma.user.findMany({
      where:   { id: { in: existing.linkedUserIds } },
      include: { groups: { include: { group: { select: { key: true } } } } },
    });

    const results: { userId: string; username: string; skipped: boolean; reason?: string }[] = [];

    for (const user of users) {
      const isStaff = user.groups.some((ug) => STAFF_KEYS.has(ug.group.key));
      if (isStaff) {
        results.push({ userId: user.id, username: user.username, skipped: true, reason: "staff member" });
        continue;
      }
      const alreadyBanned = await prisma.moderationBan.findFirst({ where: { userId: user.id, status: "active" } });
      if (alreadyBanned) {
        results.push({ userId: user.id, username: user.username, skipped: true, reason: "already banned" });
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.moderationBan.create({
          data: { userId: user.id, issuedById: actorId, type: "permanent", reason: BAN_REASON, status: "active", expiresAt: null },
        });
        await tx.user.update({ where: { id: user.id }, data: { bannedUntil: new Date("9999-12-31") } });
        // Individual log entry per banned user — clearly readable in the mod log
        await tx.moderationLog.create({
          data: {
            actorId,
            actorType:  "user",
            action:     "ban.issued",
            targetType: "user",
            targetId:   user.id,
            reason:     `Banned ${user.username} for Multiaccounting`,
          },
        });
      });
      await notificationService.dispatch({
        userId:   user.id,
        type:     "moderation.ban_issued",
        title:    "Your account has been permanently suspended",
        body:     BAN_REASON,
        channels: ["in_app"],
      });
      results.push({ userId: user.id, username: user.username, skipped: false });
    }

    const bannedNames = results.filter((r) => !r.skipped).map((r) => r.username);

    // Mark case as resolved (not "reviewed" — that's reserved for exceptions only)
    await prisma.moderationCase.update({
      where: { id: caseId },
      data:  { status: "resolved", reviewedBy: actorId, reviewedAt: new Date() },
    });
    // Summary log entry so the case closure is also visible
    await writeModLog({
      actorId, actorType: "user",
      action:     "case.ban_all",
      targetType: "moderation_case",
      targetId:   caseId,
      reason:     bannedNames.length > 0
        ? `Banned for Multiaccounting: ${bannedNames.join(", ")}`
        : `No users banned (all skipped)`,
    });

    // Alert the mod team that flagged accounts from this case were banned.
    if (bannedNames.length > 0) {
      await notifyCaseManagersOfBan(bannedNames.join(", "), existing.type, actorId);
    }

    return results;
  },

  /** Auto-ban accounts the security scan judged to be the same person
   *  (multi-accounting). System action: `issued_by` is a required FK and there
   *  is no system user, so it's attributed to the oldest admin while the mod log
   *  records SYSTEM. Bans every non-staff, not-already-banned account permanently
   *  and alerts the mod team. Returns the banned usernames. Opt-in (§15 override)
   *  — the caller checks `moderation.auto_ban_multiaccounts` before invoking. */
  async autoBanMultiaccounts(userIds: string[], reason: string): Promise<string[]> {
    const STAFF_KEYS = new Set(["admin", "supermod", "moderator"]);
    const admin = await prisma.user.findFirst({
      where:   { groups: { some: { group: { key: "admin" } } } },
      orderBy: { createdAt: "asc" },
      select:  { id: true },
    });
    if (!admin) return [];   // no admin to attribute the ban to — skip

    const users = await prisma.user.findMany({
      where:   { id: { in: userIds } },
      include: { groups: { include: { group: { select: { key: true } } } } },
    });

    const banned: string[] = [];
    for (const user of users) {
      if (user.groups.some((ug) => STAFF_KEYS.has(ug.group.key))) continue;
      const already = await prisma.moderationBan.findFirst({ where: { userId: user.id, status: "active" } });
      if (already) continue;

      await prisma.$transaction(async (tx) => {
        await tx.moderationBan.create({
          data: { userId: user.id, issuedById: admin.id, type: "permanent", reason, status: "active", expiresAt: null },
        });
        await tx.user.update({ where: { id: user.id }, data: { bannedUntil: new Date("9999-12-31") } });
        await tx.moderationLog.create({
          data: { actorId: null, actorType: "system", action: "ban.auto_issued", targetType: "user", targetId: user.id, reason },
        });
      });
      await notificationService.dispatch({
        userId:   user.id,
        type:     "moderation.ban_issued",
        title:    "Your account has been permanently suspended",
        body:     reason,
        channels: ["in_app"],
      });
      banned.push(user.username);
    }

    if (banned.length > 0) await notifyCaseManagersOfBan(banned.join(", "), "multi_account_suspicion", admin.id);
    return banned;
  },

  async moderatorDeleteArticleComment(commentId: string, actorId: string, reason: string) {
    const comment = await prisma.articleComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw NodevoError.notFound("Comment not found");

    await prisma.articleComment.update({
      where: { id: commentId },
      data:  { deletedAt: new Date(), deletedById: actorId, deletedReason: reason },
    });

    await writeModLog({
      actorId,
      actorType:  "user",
      action:     "comment.deleted",
      targetType: "article_comment",
      targetId:   commentId,
      reason,
    });
  },

  async moderatorDeleteProfileComment(commentId: string, actorId: string, reason: string) {
    const comment = await prisma.profileComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw NodevoError.notFound("Comment not found");

    await prisma.profileComment.update({
      where: { id: commentId },
      data:  { deletedAt: new Date(), deletedById: actorId, deletedReason: reason },
    });

    await writeModLog({
      actorId,
      actorType:  "user",
      action:     "profile_comment.deleted",
      targetType: "profile_comment",
      targetId:   commentId,
      reason,
    });
  },

  // ── Canvas read endpoints ────────────────────────────────────────────────────

  /** Typeahead user search for ModCanvas warn/ban forms. Mod-accessible
   *  (does not require admin.access like the ACP user list does). */
  async searchUsers(opts: { search: string; limit: number }) {
    const { search, limit } = opts;
    const data = await prisma.user.findMany({
      where: {
        username: { contains: search, mode: "insensitive" },
      },
      take: limit,
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
      },
    });
    return {
      data: data.map((u) => ({
        id:         u.id,
        username:   u.username,
        badgeColor: u.groups[0]?.group.progression?.badgeColor ?? null,
      })),
    };
  },

  async getSummary() {
    const [pendingReports, openCases, activeWarnings, activeBans] = await Promise.all([
      prisma.moderationReport.count({ where: { status: "pending" } }),
      prisma.moderationCase.count({ where: { status: "open" } }),
      prisma.moderationWarning.count({ where: { status: "active" } }),
      prisma.moderationBan.count({ where: { status: "active" } }),
    ]);
    return { pendingReports, openCases, activeWarnings, activeBans };
  },

  async listReportsCanvas(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const badgeColorSelect = {
      groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
    };
    const [data, total] = await Promise.all([
      prisma.moderationReport.findMany({
        where: { status: "pending" },
        skip:  (page - 1) * limit,
        take:  limit,
        orderBy: { createdAt: "desc" },
        include: {
          reporter:   { select: { id: true, username: true, ...badgeColorSelect } },
          targetUser: { select: { id: true, username: true, ...badgeColorSelect } },
        },
      }),
      prisma.moderationReport.count({ where: { status: "pending" } }),
    ]);
    return {
      data: data.map((r) => ({
        ...r,
        reporter: {
          id:         r.reporter.id,
          username:   r.reporter.username,
          badgeColor: r.reporter.groups[0]?.group.progression?.badgeColor ?? null,
        },
        targetUser: r.targetUser ? {
          id:         r.targetUser.id,
          username:   r.targetUser.username,
          badgeColor: r.targetUser.groups[0]?.group.progression?.badgeColor ?? null,
        } : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async listWarningsCanvas(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const badgeColorSelect = {
      groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
    };
    const [data, total] = await Promise.all([
      prisma.moderationWarning.findMany({
        where: { status: "active" },
        skip:  (page - 1) * limit,
        take:  limit,
        orderBy: { createdAt: "desc" },
        include: {
          user:     { select: { id: true, username: true, ...badgeColorSelect } },
          issuedBy: { select: { id: true, username: true, ...badgeColorSelect } },
        },
      }),
      prisma.moderationWarning.count({ where: { status: "active" } }),
    ]);
    return {
      data: data.map((w) => ({
        ...w,
        user:     { id: w.user.id,     username: w.user.username,     badgeColor: w.user.groups[0]?.group.progression?.badgeColor ?? null },
        issuedBy: { id: w.issuedBy.id, username: w.issuedBy.username, badgeColor: w.issuedBy.groups[0]?.group.progression?.badgeColor ?? null },
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async listBansCanvas(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const badgeColorSelect = {
      groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } },
    };
    const [data, total] = await Promise.all([
      prisma.moderationBan.findMany({
        where: { status: "active" },
        skip:  (page - 1) * limit,
        take:  limit,
        orderBy: { createdAt: "desc" },
        include: {
          user:     { select: { id: true, username: true, ...badgeColorSelect } },
          issuedBy: { select: { id: true, username: true, ...badgeColorSelect } },
        },
      }),
      prisma.moderationBan.count({ where: { status: "active" } }),
    ]);
    return {
      data: data.map((b) => ({
        ...b,
        user:     { id: b.user.id,     username: b.user.username,     badgeColor: b.user.groups[0]?.group.progression?.badgeColor ?? null },
        issuedBy: { id: b.issuedBy.id, username: b.issuedBy.username, badgeColor: b.issuedBy.groups[0]?.group.progression?.badgeColor ?? null },
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async listCasesCanvas(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const [rows, total] = await Promise.all([
      prisma.moderationCase.findMany({
        where:   { status: "open" },
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.moderationCase.count({ where: { status: "open" } }),
    ]);
    const resolved = await resolveCaseUsers(rows);

    // Attach distinct IPs for all linked users (same as admin listCases)
    const allIds = [...new Set(rows.flatMap((r) => r.linkedUserIds))];
    const ipRows = allIds.length > 0
      ? await prisma.loginEvent.findMany({
          where:    { userId: { in: allIds }, ip: { not: null }, success: true },
          select:   { ip: true },
          distinct: ["ip"],
        })
      : [];
    const ipAddresses = [...new Set(ipRows.map((r) => r.ip).filter(Boolean) as string[])];

    const data = resolved.map((r) => ({ ...r, ipAddresses }));
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async listLogCanvas(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const [rows, total] = await Promise.all([
      prisma.moderationLog.findMany({
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.moderationLog.count(),
    ]);

    // Resolve actor + user-target usernames, and case-target linked users
    const userIds = new Set<string>();
    for (const r of rows) {
      if (r.actorId)                              userIds.add(r.actorId);
      if (r.targetId && r.targetType === "user")  userIds.add(r.targetId);
    }

    const caseIds = rows
      .filter((r) => r.targetType === "moderation_case" && r.targetId)
      .map((r) => r.targetId as string);
    const cases = caseIds.length > 0
      ? await prisma.moderationCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, type: true, linkedUserIds: true } })
      : [];
    const caseMap = new Map(cases.map((c) => [c.id, c]));
    cases.forEach((c) => c.linkedUserIds.forEach((uid) => userIds.add(uid)));

    const users = userIds.size > 0
      ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true } })
      : [];
    const umap = new Map(users.map((u) => [u.id, u.username]));

    const data = rows.map((r) => {
      let targetUsername: string | null = null;
      let targetDetail:   string | null = null;
      if (r.targetId && r.targetType === "user") {
        targetUsername = umap.get(r.targetId) ?? r.targetId;
      } else if (r.targetId && r.targetType === "moderation_case") {
        // Subject = the case TYPE (e.g. "Multiaccounting"); detail = who shares what.
        const c      = caseMap.get(r.targetId);
        const names  = (c?.linkedUserIds ?? []).map((uid) => umap.get(uid) ?? uid).filter(Boolean);
        targetUsername = c ? humanizeCaseType(c.type) : "Case";
        targetDetail   = c ? describeCaseSignal(c.type, names) : null;
      } else if (r.targetType === "device_cookie") {
        targetUsername = r.targetId ? `Cookie ${r.targetId.slice(0, 8)}…` : "Device Cookie";
      } else if (r.targetType === "ip") {
        targetUsername = r.targetId ?? "IP";
      }
      return {
        ...r,
        actorUsername:  r.actorId ? (umap.get(r.actorId) ?? r.actorId) : null,
        targetUsername,
        targetDetail,
      };
    });

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  // ── Ban / lift ban (canvas) ────────────────────────────────────────────────

  async issueBan(data: {
    userId:     string;
    issuedById: string;
    type:       "temporary" | "permanent";
    reason:     string;
    expiresAt?: Date | null;
  }) {
    const user = await prisma.user.findUnique({
      where:   { id: data.userId },
      include: { groups: { include: { group: { select: { key: true, name: true } } } } },
    });
    if (!user) throw NodevoError.notFound("User not found");
    if (data.userId === data.issuedById) throw NodevoError.forbidden("Cannot ban yourself");

    const STAFF_KEYS = new Set(["admin", "supermod", "moderator"]);
    const staffGroup = user.groups.find((ug) => STAFF_KEYS.has(ug.group.key));
    if (staffGroup) throw NodevoError.forbidden(`You cannot ban a ${staffGroup.group.name} member`);

    const alreadyBanned = await prisma.moderationBan.findFirst({ where: { userId: data.userId, status: "active" } });
    if (alreadyBanned) throw NodevoError.forbidden("User is already banned");

    await prisma.$transaction(async (tx) => {
      await tx.moderationBan.create({
        data: { userId: data.userId, issuedById: data.issuedById, type: data.type, reason: data.reason, status: "active", expiresAt: data.expiresAt ?? null },
      });
      const bannedUntil = data.type === "permanent" ? new Date("9999-12-31") : (data.expiresAt ?? null);
      await tx.user.update({ where: { id: data.userId }, data: { bannedUntil } });
      await tx.moderationLog.create({
        data: { actorId: data.issuedById, actorType: "user", action: "ban.issued", targetType: "user", targetId: data.userId, reason: data.reason },
      });
    });

    await notificationService.dispatch({
      userId:   data.userId,
      type:     "moderation.ban_issued",
      title:    data.type === "permanent" ? "Your account has been permanently suspended" : "Your account has been temporarily suspended",
      body:     data.reason,
      channels: ["in_app", "email"],
    });

    // If this user is flagged in an open review case (multi-account, impossible
    // travel, evasion…), alert the mod team that a flagged account was banned.
    const linkedCase = await findActiveCaseForUser(data.userId);
    if (linkedCase) await notifyCaseManagersOfBan(user.username, linkedCase.type, data.issuedById);
  },

  // ── User lookup (mini-profile for the Users section) ───────────────────────

  /** Full moderation view of a single user: identity + counters, warning & ban
   *  history (active + historical), network telemetry (IPs / device cookies),
   *  active sessions, and recent articles. Forum threads/posts are contributed
   *  by the forum plugin separately (it owns that data). */
  async getUserModProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where:   { id: userId },
      include: {
        groups: {
          include: {
            group: {
              select: {
                name: true, key: true, displayOrder: true,
                progression: { select: { badgeColor: true, badgeLabel: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw NodevoError.notFound("User not found");

    // Warnings and bans are loaded lazily per-tab by the canvas (getUserWarnings /
    // getUserBans). The profile only needs the active ban to render the "Currently
    // banned · Lift ban" bar at the top.
    const [activeBan, ipGroups, cookieGroups, sessions] = await Promise.all([
      prisma.moderationBan.findFirst({
        where:   { userId, status: "active" },
        orderBy: { createdAt: "desc" },
        select:  { id: true, type: true, expiresAt: true },
      }),
      prisma.loginEvent.groupBy({
        by:      ["ip"],
        where:   { userId, ip: { not: null } },
        _count:  { ip: true },
        _max:    { createdAt: true },
      }),
      prisma.loginEvent.groupBy({
        by:      ["deviceCookieId"],
        where:   { userId, deviceCookieId: { not: null } },
        _count:  { deviceCookieId: true },
        _max:    { createdAt: true },
      }),
      prisma.session.findMany({
        where:   { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: "desc" },
        select:  { id: true, ip: true, userAgent: true, deviceCookieId: true, lastUsedAt: true, createdAt: true, expiresAt: true },
      }),
    ]);

    return {
      user: {
        id:              user.id,
        username:        user.username,
        displayName:     user.displayName,
        avatar:          resolveAvatar(user.avatar),
        bio:             user.bio,
        isActive:        user.isActive,
        bannedUntil:     user.bannedUntil,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt:       user.createdAt,
        groups: user.groups.map((ug) => ({
          name:         ug.group.name,
          key:          ug.group.key,
          displayOrder: ug.group.displayOrder,
          badgeColor:   ug.group.progression?.badgeColor ?? null,
          badgeLabel:   ug.group.progression?.badgeLabel ?? null,
        })),
        counters: {
          postCount:         user.postCount,
          threadCount:       user.threadCount,
          articleCount:      user.articleCount,
          likeCountReceived: user.likeCountReceived,
          followerCount:     user.followerCount,
          followingCount:    user.followingCount,
        },
      },
      activeBan,
      network: {
        ips: ipGroups
          .filter((g) => g.ip)
          .map((g) => ({ ip: g.ip as string, count: g._count.ip, lastSeen: g._max.createdAt }))
          .sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0)),
        cookies: cookieGroups
          .filter((g) => g.deviceCookieId)
          .map((g) => ({ deviceCookieId: g.deviceCookieId as string, count: g._count.deviceCookieId, lastSeen: g._max.createdAt }))
          .sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0)),
      },
      sessions,
    };
  },

  /** A user's full warning history (active + historical), newest first.
   *  Loaded lazily by the canvas Warnings tab. */
  async getUserWarnings(userId: string) {
    const warnings = await prisma.moderationWarning.findMany({
      where:   { userId },
      take:    50,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { issuedBy: { select: { id: true, username: true, ...issuerSelect } } },
    });
    return warnings.map((w) => ({
      id: w.id, reason: w.reason, status: w.status,
      expiresAt: w.expiresAt, createdAt: w.createdAt, issuedBy: mapIssuer(w.issuedBy),
    }));
  },

  /** A user's full ban history (active + historical), newest first.
   *  Loaded lazily by the canvas Bans tab. */
  async getUserBans(userId: string) {
    const bans = await prisma.moderationBan.findMany({
      where:   { userId },
      take:    50,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { issuedBy: { select: { id: true, username: true, ...issuerSelect } } },
    });
    return bans.map((b) => ({
      id: b.id, type: b.type, reason: b.reason, status: b.status,
      expiresAt: b.expiresAt, createdAt: b.createdAt, issuedBy: mapIssuer(b.issuedBy),
    }));
  },

  /** Force-logout: revoke every active session for the user. Logged.
   *  A mod cannot log out a user ranked higher than themselves — rank is the
   *  user's highest group precedence (lower `displayOrder` = higher rank). */
  async revokeAllSessions(userId: string, actorId: string) {
    const groupSelect = { groups: { include: { group: { select: { displayOrder: true } } } } };
    const [user, actor] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, ...groupSelect } }),
      prisma.user.findUnique({ where: { id: actorId }, select: { id: true, ...groupSelect } }),
    ]);
    if (!user) throw NodevoError.notFound("User not found");

    const rank = (u: { groups: { group: { displayOrder: number } }[] }) =>
      u.groups.length ? Math.min(...u.groups.map((ug) => ug.group.displayOrder)) : Infinity;
    if (actor && rank(user) < rank(actor)) {
      throw NodevoError.forbidden("You cannot log out a higher-ranked user");
    }

    const { count } = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    });

    await writeModLog({
      actorId,
      actorType:  "user",
      action:     "session.revoke_all",
      targetType: "user",
      targetId:   userId,
      reason:     `Force logout — ${count} session(s) revoked`,
    });

    return { revoked: count };
  },

  async liftBanById(banId: string, liftedById: string) {
    const ban = await prisma.moderationBan.findUnique({ where: { id: banId } });
    if (!ban || ban.status !== "active") throw NodevoError.notFound("Active ban not found");

    await prisma.$transaction(async (tx) => {
      await tx.moderationBan.update({ where: { id: banId }, data: { status: "lifted", liftedAt: new Date(), liftedBy: liftedById } });
      await tx.user.update({ where: { id: ban.userId }, data: { bannedUntil: null } });
      await tx.moderationLog.create({
        data: { actorId: liftedById, actorType: "user", action: "ban.lifted", targetType: "user", targetId: ban.userId, reason: `Ban lifted (was: ${ban.reason})` },
      });
    });

    await notificationService.dispatch({
      userId:   ban.userId,
      type:     "moderation.ban_lifted",
      title:    "Your account suspension has been lifted",
      body:     "Your suspension has been removed. You can now log in.",
      channels: ["in_app"],
    });
  },
};
