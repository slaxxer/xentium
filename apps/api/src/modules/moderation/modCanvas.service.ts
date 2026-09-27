/**
 * ModCanvas → Reports (the split inspector) and ModCanvas → Templates.
 *
 * Reports are GROUPED by what they are about: five people reporting one comment is
 * one decision, and acting on it closes all five. Every action runs here, server-side,
 * so "warn and resolve the group" cannot half-happen because a browser tab closed
 * between two requests.
 */
import { z } from "zod";
import { CorePermissions } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { assertPermission } from "../../shared/middleware/requirePermission.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { badgeColorSelect, toUserRef } from "../../shared/utils/userRef.js";
import { notificationService } from "../notifications/notification.service.js";
import { moderationService } from "./moderation.service.js";
import { getModPolicy } from "./moderationPolicy.js";
import { describeTarget, type TargetInfo } from "./reportTarget.js";

// ── The inspector ────────────────────────────────────────────────────────────

const NONE: TargetInfo = { authorId: null, snapshot: null, where: null, href: null };
const USER_CARD = { id: true, username: true, avatar: true, createdAt: true, ...badgeColorSelect } as const;
const MAX_OPEN = 500;

export const modCanvasService = {
  /** Every pending report, one row per reported thing. */
  async inspector() {
    const [reports, policy] = await Promise.all([
      prisma.moderationReport.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: MAX_OPEN,
        include: { reporter: { select: USER_CARD } },
      }),
      getModPolicy(),
    ]);

    const groups = new Map<string, typeof reports>();
    for (const r of reports) {
      const key = `${r.targetType}:${r.targetId}`;
      const list = groups.get(key);
      if (list) list.push(r); else groups.set(key, [r]);
    }

    const described = new Map<string, TargetInfo>();
    await Promise.all([...groups.entries()].map(async ([key, list]) => {
      described.set(key, await describeTarget(list[0]!.targetType, list[0]!.targetId));
    }));

    const authorOf = (key: string, list: typeof reports) =>
      list.find((r) => r.targetUserId)?.targetUserId ?? described.get(key)?.authorId ?? null;
    const authorIds = [...new Set([...groups.entries()].map(([k, l]) => authorOf(k, l)).filter((x): x is string => !!x))];
    const claimIds = [...new Set(reports.map((r) => r.assignedTo).filter((x): x is string => !!x))];

    const [authors, claimers, counts] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: authorIds } }, select: USER_CARD }),
      prisma.user.findMany({ where: { id: { in: claimIds } }, select: { id: true, username: true } }),
      Promise.all(authorIds.map(async (id) => [id, await moderationService.countedWarnings(id, policy.resetAfterBan)] as const)),
    ]);
    const authorMap = new Map(authors.map((u) => [u.id, u]));
    const claimMap = new Map(claimers.map((u) => [u.id, u]));
    const warnings = new Map(counts);
    const openPerAuthor = new Map<string, number>();
    for (const [k, l] of groups) {
      const a = authorOf(k, l);
      if (a) openPerAuthor.set(a, (openPerAuthor.get(a) ?? 0) + 1);
    }
    // The ladder a warning would climb: what the NEXT one triggers, for the composer's notice.
    const ladderTop = policy.ladder.reduce((n, s) => Math.max(n, s.warningCount), 0);

    const data = [...groups.entries()].map(([key, list]) => {
      const info = described.get(key) ?? NONE;
      const authorId = authorOf(key, list);
      const author = authorId ? authorMap.get(authorId) : undefined;
      const active = authorId ? (warnings.get(authorId) ?? 0) : 0;
      const next = policy.ladder.find((s) => s.warningCount === active + 1) ?? null;
      const claimedById = list.find((r) => r.assignedTo)?.assignedTo ?? null;
      return {
        key,
        targetType: list[0]!.targetType,
        targetId: list[0]!.targetId,
        where: info.where,
        href: info.href,
        snapshot: list.find((r) => r.contentSnapshot)?.contentSnapshot ?? info.snapshot,
        firstReportedAt: list[list.length - 1]!.createdAt,
        latestAt: list[0]!.createdAt,
        reports: list.map((r) => ({
          id: r.id,
          reason: r.reason,
          createdAt: r.createdAt,
          reporter: { ...toUserRef(r.reporter), avatar: resolveAvatar(r.reporter.avatar) },
        })),
        author: author ? {
          ...toUserRef(author),
          avatar: resolveAvatar(author.avatar),
          joinedAt: author.createdAt,
          activeWarnings: active,
          ladderSize: ladderTop,
          nextStep: next,
          otherOpenReports: Math.max(0, (openPerAuthor.get(author.id) ?? 1) - 1),
        } : null,
        claimedBy: claimedById ? (claimMap.get(claimedById) ?? { id: claimedById, username: "?" }) : null,
      };
    });

    return { data, total: reports.length };
  },

  /** The pending reports named, which must all be about the same thing. */
  async group(reportIds: string[]) {
    const reports = await prisma.moderationReport.findMany({ where: { id: { in: reportIds }, status: "pending" } });
    if (reports.length === 0) throw XentiumError.notFound("These reports were already handled");
    const first = reports[0]!;
    if (reports.some((r) => r.targetType !== first.targetType || r.targetId !== first.targetId)) {
      throw new XentiumError({ code: "XEC-API-4001", httpStatus: 400, message: "An action applies to reports about one thing" });
    }
    return reports;
  },

  /**
   * Warn, ban, remove or dismiss from a report group, then close the group.
   *
   * The message is the moderator's (usually a filled template). `notify: false`
   * keeps a warning or ban silent to the member, which the old quick actions could
   * not do.
   */
  async act(actorId: string, input: ActInput) {
    const reports = await this.group(input.reportIds);
    const { targetType, targetId } = reports[0]!;
    const info = await describeTarget(targetType, targetId);
    const authorId = reports.find((r) => r.targetUserId)?.targetUserId ?? info.authorId;

    if (input.mode === "warn" || input.mode === "ban") {
      if (!authorId) throw new XentiumError({ code: "XEC-API-4001", httpStatus: 400, message: "This report names no author to act on" });
    }

    if (input.mode === "warn") {
      await assertPermission(actorId, CorePermissions.MODERATION_WARN_MANAGE);
      await moderationService.issueWarning({ userId: authorId!, issuedById: actorId, reason: input.message, notify: input.notify });
    } else if (input.mode === "ban") {
      await assertPermission(actorId, CorePermissions.MODERATION_BAN_MANAGE);
      const hours = DURATION_HOURS[input.duration ?? "7d"];
      await moderationService.issueBan({
        userId: authorId!, issuedById: actorId, reason: input.message, notify: input.notify,
        type: hours === null ? "permanent" : "temporary",
        expiresAt: hours === null ? null : new Date(Date.now() + hours * 3_600_000),
      });
    } else if (input.mode === "delete") {
      await assertPermission(actorId, CorePermissions.MODERATION_REPORT_MANAGE);
      await removeContent(targetType, targetId, actorId, input.message);
      if (input.notify && authorId) {
        await notificationService.dispatch({
          userId: authorId, type: "moderation.content_removed", title: "Your content was removed",
          body: input.message, channels: ["in_app"],
        });
      }
    } else {
      await assertPermission(actorId, CorePermissions.MODERATION_REPORT_MANAGE);
      if (input.notify) {
        // A dismissal's text is an internal note; reporters hear only that it was looked at.
        const reporters = [...new Set(reports.map((r) => r.reporterId))];
        await Promise.all(reporters.map((userId) => notificationService.dispatch({
          userId, type: "moderation.report_reviewed", title: "Your report was reviewed",
          body: "A moderator looked at your report and found no rule broken. Thanks for flagging it.",
          channels: ["in_app"],
        })));
      }
    }

    const status = input.mode === "dismiss" ? "dismissed" : "resolved";
    await this.setStatus(actorId, reports.map((r) => r.id), status, input.mode === "dismiss" ? input.message : null);
    if (input.templateId) {
      await prisma.moderationTemplate.updateMany({ where: { id: input.templateId }, data: { useCount: { increment: 1 } } });
    }
    return { status, count: reports.length };
  },

  /** Close (or, for Undo, reopen) reports — the bulk bar and the action above both land here. */
  async setStatus(actorId: string, reportIds: string[], status: "resolved" | "dismissed" | "pending", note: string | null = null) {
    const reports = await prisma.moderationReport.findMany({ where: { id: { in: reportIds } } });
    if (reports.length === 0) return { count: 0 };
    const closing = status !== "pending";
    await prisma.moderationReport.updateMany({
      where: { id: { in: reports.map((r) => r.id) } },
      data: { status, resolvedAt: closing ? new Date() : null, resolvedBy: closing ? actorId : null },
    });
    // One log line per reported thing, not per report.
    const targets = new Map(reports.map((r) => [`${r.targetType}:${r.targetId}`, r]));
    await prisma.moderationLog.createMany({
      data: [...targets.values()].map((r) => ({
        actorId, actorType: "user",
        action: closing ? `report.${status}` : "report.reopened",
        targetType: r.targetType, targetId: r.targetId,
        reason: note,
        meta: { reports: reports.filter((x) => x.targetType === r.targetType && x.targetId === r.targetId).length },
      })),
    });
    return { count: reports.length };
  },

  /** Claim a group (or release it). Anyone may take over a claim; the log says who. */
  async claim(actorId: string, reportIds: string[], on: boolean) {
    const reports = await this.group(reportIds);
    await prisma.moderationReport.updateMany({
      where: { id: { in: reports.map((r) => r.id) } },
      data: { assignedTo: on ? actorId : null },
    });
    await prisma.moderationLog.create({
      data: {
        actorId, actorType: "user", action: on ? "report.claimed" : "report.unclaimed",
        targetType: reports[0]!.targetType, targetId: reports[0]!.targetId,
      },
    });
    return { claimedBy: on ? await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, username: true } }) : null };
  },

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates() {
    const rows = await prisma.moderationTemplate.findMany({
      where: { deletedAt: null },
      // `name` last: seeded rows share one timestamp, and an unstable order moved the suggestion.
      orderBy: [{ useCount: "desc" }, { createdAt: "asc" }, { name: "asc" }],
    });
    const editors = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))] } },
      select: { id: true, username: true },
    });
    const byId = new Map(editors.map((u) => [u.id, u.username]));
    return rows.map((r) => ({
      ...templateView(r),
      isDefault: DEFAULT_KEYS.has(defaultKey(r.mode, r.name)),
      updatedBy: r.updatedById ? (byId.get(r.updatedById) ?? null) : null,
    }));
  },

  async createTemplate(actorId: string, input: TemplateInput) {
    const row = await prisma.moderationTemplate.create({ data: { ...templateData(input), updatedById: actorId } });
    return templateView(row);
  },

  async updateTemplate(actorId: string, id: string, input: Partial<TemplateInput>) {
    const existing = await prisma.moderationTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw XentiumError.notFound("Template not found");
    const row = await prisma.moderationTemplate.update({
      where: { id }, data: { ...templateData({ ...templateView(existing), ...input }), updatedById: actorId },
    });
    return templateView(row);
  },

  /** Add back every default text that is missing. Edited ones are left as they are. */
  async restoreDefaults(actorId: string) {
    const present = await prisma.moderationTemplate.findMany({ where: { deletedAt: null }, select: { mode: true, name: true } });
    const have = new Set(present.map((t) => defaultKey(t.mode, t.name)));
    const missing = DEFAULT_TEMPLATES.filter((t) => !have.has(defaultKey(t.mode, t.name)));
    if (missing.length) {
      await prisma.moderationTemplate.createMany({ data: missing.map((t) => ({ ...templateData(t), updatedById: actorId })) });
    }
    return { restored: missing.length };
  },

  async deleteTemplate(id: string) {
    const res = await prisma.moderationTemplate.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw XentiumError.notFound("Template not found");
  },
};

// ── The default set ──────────────────────────────────────────────────────────

/**
 * The starting texts every site gets — the same rows the migration seeded. An admin
 * edits or deletes them freely; "Restore defaults" brings back any that are MISSING
 * (matched by mode + name) and never overwrites one that was edited.
 */
export const DEFAULT_TEMPLATES: TemplateInput[] = [
  { mode: "warn", name: "Harassment", text: "Hi {user}, your {type} on {where} was reported for harassment. Personal attacks break our community rules. This is a formal warning, and further reports may lead to a ban.", matchCategories: ["harassment", "abuse", "insult", "attack", "rude"] },
  { mode: "warn", name: "Spam / self-promotion", text: "Hi {user}, your {type} on {where} contains promotional links. Self-promotion isn't allowed here. Please remove similar posts.", matchCategories: ["spam", "advert", "promotion", "link"] },
  { mode: "warn", name: "Off-topic flooding", text: "Hi {user}, repeated low-effort replies like the one on {where} disrupt threads for everyone. Please keep replies on topic.", matchCategories: ["off-topic", "offtopic", "flood", "low effort"] },
  { mode: "warn", name: "Uncredited work", text: "Hi {user}, your {type} on {where} uses someone else's work without credit. Please credit the original creator or remove it.", matchCategories: ["credit", "stolen", "copied", "plagiarism"] },
  { mode: "ban", name: "Repeated harassment", text: "You have been banned for {duration} for repeated harassment after prior warnings. Your {type} on {where} was the deciding report.", defaultDuration: "7d", matchCategories: ["harassment", "abuse"] },
  { mode: "ban", name: "Spam account", text: "This account has been banned for posting spam, including your {type} on {where}.", defaultDuration: "perm", matchCategories: ["spam", "bot"] },
  { mode: "ban", name: "Ban evasion", text: "This account is linked to a previously banned account and has been banned for ban evasion.", defaultDuration: "perm", matchCategories: ["evasion", "alt", "multi"] },
  { mode: "ban", name: "Phishing / impersonation", text: "This account has been banned for impersonating staff and asking members for login details on {where}.", defaultDuration: "perm", matchCategories: ["phishing", "impersonation", "scam"] },
  { mode: "ban", name: "Hate speech", text: "You have been banned for {duration} for hateful language in your {type} on {where}.", defaultDuration: "30d", matchCategories: ["hate", "racism", "slur"] },
  { mode: "delete", name: "Removed: rule violation", text: "Your {type} on {where} was removed because it breaks our community rules.", matchCategories: [] },
  { mode: "delete", name: "Removed: copyright", text: "Your {type} on {where} was removed after a copyright report. You can post it again with credit or the creator's permission.", matchCategories: ["copyright", "dmca"] },
  { mode: "dismiss", name: "No violation found", text: "Reviewed {type} on {where}. No rule broken.", matchCategories: [] },
  { mode: "dismiss", name: "Duplicate report", text: "Duplicate of a report that was already handled.", matchCategories: ["duplicate"] },
];

const defaultKey = (mode: string, name: string) => `${mode}\u0000${name.trim().toLowerCase()}`;
const DEFAULT_KEYS = new Set(DEFAULT_TEMPLATES.map((t) => defaultKey(t.mode, t.name)));

// ── Actions: shapes and helpers ──────────────────────────────────────────────

export const DURATIONS = ["1h", "24h", "7d", "30d", "perm"] as const;
const DURATION_HOURS: Record<(typeof DURATIONS)[number], number | null> = {
  "1h": 1, "24h": 24, "7d": 168, "30d": 720, perm: null,
};
export const MODES = ["warn", "ban", "delete", "dismiss"] as const;

export const actSchema = z.object({
  reportIds:  z.array(z.string().min(1)).min(1).max(100),
  mode:       z.enum(MODES),
  templateId: z.string().min(1).nullable().optional(),
  message:    z.string().trim().min(3).max(2000),
  notify:     z.boolean().default(true),
  duration:   z.enum(DURATIONS).optional(),
});
export type ActInput = z.infer<typeof actSchema>;

export const templateSchema = z.object({
  mode:            z.enum(MODES),
  name:            z.string().trim().min(1).max(80),
  text:            z.string().trim().min(1).max(2000),
  ruleRef:         z.string().trim().max(80).nullable().optional(),
  defaultDuration: z.enum(DURATIONS).nullable().optional(),
  matchCategories: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
});
export type TemplateInput = z.infer<typeof templateSchema>;

function templateData(t: TemplateInput) {
  return {
    mode: t.mode,
    name: t.name,
    text: t.text,
    ruleRef: t.ruleRef || null,
    // A length only means something on a ban; a dismissal is never sent.
    defaultDuration: t.mode === "ban" ? (t.defaultDuration ?? "7d") : null,
    internal: t.mode === "dismiss",
    matchCategories: t.matchCategories ?? [],
  };
}

function templateView(r: {
  id: string; mode: string; name: string; text: string; ruleRef: string | null; defaultDuration: string | null;
  internal: boolean; matchCategories: string[]; useCount: number; updatedAt: Date;
}) {
  return {
    id: r.id, mode: r.mode as (typeof MODES)[number], name: r.name, text: r.text, ruleRef: r.ruleRef,
    defaultDuration: r.defaultDuration as (typeof DURATIONS)[number] | null, internal: r.internal,
    matchCategories: r.matchCategories, useCount: r.useCount, updatedAt: r.updatedAt,
  };
}

/** Take the reported content down. Only what core owns can be removed from here. */
async function removeContent(targetType: string, targetId: string, actorId: string, reason: string) {
  if (targetType === "article_comment") return moderationService.moderatorDeleteArticleComment(targetId, actorId, reason);
  if (targetType === "profile_comment") return moderationService.moderatorDeleteProfileComment(targetId, actorId, reason);
  if (targetType === "article") {
    const res = await prisma.article.updateMany({ where: { id: targetId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw XentiumError.notFound("Article not found");
    await prisma.moderationLog.create({
      data: { actorId, actorType: "user", action: "article.deleted", targetType: "article", targetId, reason },
    });
    return;
  }
  throw new XentiumError({
    code: "XEC-API-4001", httpStatus: 400,
    message: "This kind of content can't be removed from here. Open it and use its own tools.",
  });
}
