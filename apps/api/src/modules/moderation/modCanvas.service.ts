/**
 * ModCanvas → Reports (the split inspector) and ModCanvas → Templates.
 *
 * Reports are GROUPED by what they are about: five people reporting one comment is
 * one decision, and acting on it closes all five. Every action runs here, server-side,
 * so "warn and resolve the group" cannot half-happen because a browser tab closed
 * between two requests.
 */
import { z } from "zod";
import { CorePermissions, XEC } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { assertPermission } from "../../shared/middleware/requirePermission.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { badgeColorSelect, toUserRef } from "../../shared/utils/userRef.js";
import { notificationService } from "../notifications/notification.service.js";
import { moderationService } from "./moderation.service.js";
import { getModPolicy, DEFAULT_WARN_EXPIRY, WARN_EXPIRIES, type WarnExpiry } from "./moderationPolicy.js";
import { getSetting } from "../../shared/utils/settings.js";
import { serverText, toServerLocale, type ServerLocale } from "../../shared/i18n/serverText.js";
import { canRemoveTarget, describeTarget, type TargetInfo } from "./reportTarget.js";
import { reportTargetRegistry } from "../../core/report-target-registry/report-target-registry.js";

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
        canRemove: canRemoveTarget(list[0]!.targetType, list[0]!.targetId),
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

    if ((input.mode === "delete" || input.mode === "dismiss") && !input.message) {
      throw new XentiumError({ code: "XEC-API-4001", httpStatus: 400, message: "This action needs a message" });
    }

    // Warnings and bans: the template decides the text and the timing, never the request.
    if (input.mode === "warn") {
      await assertPermission(actorId, CorePermissions.MODERATION_WARN_MANAGE);
      const out = await fromTemplate({
        actorId, mode: "warn", templateId: input.templateId, userId: authorId!,
        target: { type: targetType, id: targetId }, length: input.expiry,
      });
      await moderationService.issueWarning({
        userId: authorId!, issuedById: actorId, reason: out.text, notify: input.notify, expiry: out.expiry,
      });
    } else if (input.mode === "ban") {
      await assertPermission(actorId, CorePermissions.MODERATION_BAN_MANAGE);
      const out = await fromTemplate({
        actorId, mode: "ban", templateId: input.templateId, userId: authorId!,
        target: { type: targetType, id: targetId }, length: input.duration,
      });
      await moderationService.issueBan({ userId: authorId!, issuedById: actorId, reason: out.text, notify: input.notify, ...banTiming(out.length) });
    } else if (input.mode === "delete") {
      await assertPermission(actorId, CorePermissions.MODERATION_REPORT_MANAGE);
      await removeContent(targetType, targetId, actorId, input.message!);
      if (input.notify && authorId) {
        await notificationService.dispatch({
          userId: authorId, type: "moderation.content_removed", title: "Your content was removed",
          i18n: { key: "common:notify.contentRemoved" },
          body: input.message!, channels: ["in_app"],
        });
      }
    } else {
      await assertPermission(actorId, CorePermissions.MODERATION_REPORT_MANAGE);
      if (input.notify) {
        // A dismissal's text is an internal note; reporters hear only that it was looked at.
        const reporters = [...new Set(reports.map((r) => r.reporterId))];
        await Promise.all(reporters.map((userId) => notificationService.dispatch({
          userId, type: "moderation.report_reviewed", title: "Your report was reviewed",
          i18n: { key: "common:notify.reportReviewed" },
          body: "A moderator looked at your report and found no rule broken. Thanks for flagging it.",
          channels: ["in_app"],
        })));
      }
    }

    const status = input.mode === "dismiss" ? "dismissed" : "resolved";
    await this.setStatus(actorId, reports.map((r) => r.id), status, input.mode === "dismiss" ? input.message! : null);
    if (input.templateId) await this.countTemplateUse(input.templateId);
    return { status, count: reports.length };
  },

  /** One more use of a template (the Templates page sorts by it). */
  async countTemplateUse(templateId: string) {
    await prisma.moderationTemplate.updateMany({ where: { id: templateId }, data: { useCount: { increment: 1 } } });
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
    const locale = await siteLocale();
    const rows = await prisma.moderationTemplate.findMany({
      where: { deletedAt: null },
      // The admin's order first (0 = never placed, which keeps the old most-used order
      // until someone drags). `name` last: seeded rows share one timestamp, and an
      // unstable order moved the suggestion.
      orderBy: [{ position: "asc" }, { useCount: "desc" }, { createdAt: "asc" }, { name: "asc" }],
    });
    const editors = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))] } },
      select: { id: true, username: true },
    });
    const byId = new Map(editors.map((u) => [u.id, u.username]));
    return rows.map((r) => ({
      ...templateView(r, locale),
      isDefault: !!r.defaultKey,
      updatedBy: r.updatedById ? (byId.get(r.updatedById) ?? null) : null,
    }));
  },

  async createTemplate(actorId: string, input: TemplateInput) {
    // A new template goes to the END of its action's list once the admin has
    // ordered it; while nothing is placed (all 0) it stays 0 like the rest.
    const last = await prisma.moderationTemplate.aggregate({
      where: { mode: input.mode, deletedAt: null }, _max: { position: true },
    });
    const position = (last._max.position ?? 0) > 0 ? last._max.position! + 1 : 0;
    const row = await prisma.moderationTemplate.create({ data: { ...templateData(input), position, updatedById: actorId } });
    return templateView(row, await siteLocale());
  },

  async updateTemplate(actorId: string, id: string, input: Partial<TemplateInput>) {
    const existing = await prisma.moderationTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw XentiumError.notFound("Template not found");
    const locale = await siteLocale();
    const merged = { ...templateView(existing, locale), ...input };
    // Saving a shipped text as it was shown (in the site's language) keeps it the
    // shipped one, stored in English, so it still follows a change of site language.
    // Only a real edit makes it the admin's own text.
    if (existing.defaultKey) {
      const shown = shipped(existing.defaultKey, locale);
      if (merged.name.trim() === shown.name && merged.text.trim() === shown.text) {
        Object.assign(merged, shipped(existing.defaultKey, "en"));
      }
    }
    const row = await prisma.moderationTemplate.update({
      where: { id }, data: { ...templateData(merged), updatedById: actorId },
    });
    return templateView(row, locale);
  },

  /** Add back every default text that is missing. Edited ones are left as they are. */
  /**
   * The admin's order for one action's templates (ACP drag, "Manual"). `ids` are
   * that action's templates top to bottom; each gets its place from 1. Ids that are
   * deleted or unknown are skipped; a template left out keeps its old position.
   */
  async reorderTemplates(ids: string[]) {
    await prisma.$transaction(ids.map((id, i) => prisma.moderationTemplate.updateMany({
      where: { id, deletedAt: null }, data: { position: i + 1 },
    })));
  },

  async restoreDefaults(actorId: string) {
    const present = await prisma.moderationTemplate.findMany({ where: { deletedAt: null }, select: { defaultKey: true } });
    const have = new Set(present.map((t) => t.defaultKey).filter(Boolean));
    const missing = DEFAULT_TEMPLATES.filter((t) => !have.has(t.key));
    if (missing.length) {
      await prisma.moderationTemplate.createMany({
        data: missing.map((t) => ({ ...templateData(defaultInput(t)), defaultKey: t.key, updatedById: actorId })),
      });
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
 * The starting texts every site gets — the same rows the migrations seeded, by key.
 * Their words live in `locales/<lng>/moderation.json` (`templates.<mode>.<key>`), so
 * an untouched one reads in the site's language. An admin edits or deletes them
 * freely; "Restore defaults" brings back any that are MISSING (by key) and never
 * overwrites one that was edited.
 */
export const DEFAULT_TEMPLATES: Array<{
  key: string; mode: (typeof MODES)[number]; defaultDuration?: (typeof DURATIONS)[number]; warnExpiry?: WarnExpiry;
  matchCategories: string[];
}> = [
  { key: "warn.harassment",        mode: "warn", warnExpiry: "180d", matchCategories: ["harassment", "abuse", "insult", "attack", "rude"] },
  { key: "warn.spam",              mode: "warn", warnExpiry: "90d", matchCategories: ["spam", "advert", "promotion", "link"] },
  { key: "warn.offTopic",          mode: "warn", warnExpiry: "30d", matchCategories: ["off-topic", "offtopic", "flood", "low effort"] },
  { key: "warn.uncredited",        mode: "warn", warnExpiry: "90d", matchCategories: ["credit", "stolen", "copied", "plagiarism"] },
  { key: "ban.repeatedHarassment", mode: "ban", defaultDuration: "7d", matchCategories: ["harassment", "abuse"] },
  { key: "ban.spamAccount",        mode: "ban", defaultDuration: "perm", matchCategories: ["spam", "bot"] },
  { key: "ban.banEvasion",         mode: "ban", defaultDuration: "perm", matchCategories: ["evasion", "alt", "multi"] },
  { key: "ban.phishing",           mode: "ban", defaultDuration: "perm", matchCategories: ["phishing", "impersonation", "scam"] },
  { key: "ban.hateSpeech",         mode: "ban", defaultDuration: "30d", matchCategories: ["hate", "racism", "slur"] },
  { key: "delete.ruleViolation",   mode: "delete", matchCategories: [] },
  { key: "delete.copyright",       mode: "delete", matchCategories: ["copyright", "dmca"] },
  { key: "dismiss.noViolation",    mode: "dismiss", matchCategories: [] },
  { key: "dismiss.duplicate",      mode: "dismiss", matchCategories: ["duplicate"] },
];

/** A shipped template's name and text in one language. */
function shipped(key: string, locale: ServerLocale): { name: string; text: string } {
  return {
    name: serverText(locale, "moderation", `templates.${key}.name`),
    text: serverText(locale, "moderation", `templates.${key}.text`),
  };
}

function defaultInput(t: (typeof DEFAULT_TEMPLATES)[number]): TemplateInput {
  return {
    mode: t.mode, ...shipped(t.key, "en"), defaultDuration: t.defaultDuration ?? null,
    warnExpiry: t.warnExpiry ?? null, matchCategories: t.matchCategories,
  };
}

/** The language premade texts are shown in: the site's, not the moderator's. */
async function siteLocale(): Promise<ServerLocale> {
  return toServerLocale(await getSetting<string>("site.locale", "en")) ?? "en";
}

/**
 * The words `{type}` and `{duration}` read as, in the site's language, so a filled-in
 * German template does not say "dein comment". The web fills templates in; this is
 * what it fills them with.
 */
export async function templateWords() {
  const locale = await siteLocale();
  const pick = (group: "type" | "duration", keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, serverText(locale, "moderation", `${group}.${k}`)]));
  return {
    locale,
    type: pick("type", ["article", "comment", "profile comment", "profile", "post", "thread", "message", "content"]),
    duration: pick("duration", DURATIONS),
  };
}

// ── Warnings: always a template ──────────────────────────────────────────────

/** What `{type}` names, as a key into the `type` words: `post`, `comment`, `profile`… */
export function targetKind(targetType: string, targetId: string): string {
  if (targetType === "plugin-content") return targetId.split(":")[1]?.replace(/[_-]/g, " ") || "content";
  if (targetType === "article_comment") return "comment";
  if (targetType === "profile_comment") return "profile comment";
  if (targetType === "user") return "profile";
  return targetType.replace(/[_-]/g, " ");
}

/** Put the values into a template's `{placeholders}`. Unknown ones stay as written. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? vars[key]! : all));
}

/**
 * A warning or a ban, from one of the site's templates. The moderator picks the
 * template and never writes the message or picks the timing: the same offence reads
 * the same and lasts the same whoever is on duty, and nothing typed into a request
 * reaches the member. HERE the template is filled in (`{user}`, `{type}`, `{where}`,
 * `{duration}`) from the content itself, which must be the member's own, or the text
 * could name something they never wrote.
 *
 * `length` is another expiry (warn) or length (ban) than the template's. Only a team
 * lead may give one: moderation.warn.expiry.override / moderation.ban.length.override
 * (Supermod by default). Naming the template's own length needs no permission.
 */
export async function fromTemplate(opts: {
  actorId: string;
  mode: "warn" | "ban";
  templateId: string | null | undefined;
  userId: string;
  /** What it is about. A warning always names it; a ban may not (ban evasion). */
  target?: { type: string; id: string } | null;
  length?: string | null;
}): Promise<{ text: string; expiry: WarnExpiry | null; length: (typeof DURATIONS)[number] }> {
  const row = opts.templateId
    ? await prisma.moderationTemplate.findFirst({ where: { id: opts.templateId, deletedAt: null } })
    : null;
  if (!row || row.mode !== opts.mode) {
    throw new XentiumError({ code: XEC.MOD_TEMPLATE_REQUIRED, httpStatus: 400, message: `Pick one of the ${opts.mode} templates` });
  }

  const own = opts.mode === "warn" ? (row.warnExpiry ?? DEFAULT_WARN_EXPIRY) : (row.defaultDuration ?? "7d");
  if (opts.length != null && opts.length !== own) {
    await assertPermission(opts.actorId, opts.mode === "warn"
      ? CorePermissions.MODERATION_WARN_EXPIRY_OVERRIDE
      : CorePermissions.MODERATION_BAN_LENGTH_OVERRIDE);
  }
  const length = (opts.length ?? own) as string | null;

  const user = await prisma.user.findUnique({ where: { id: opts.userId }, select: { username: true } });
  if (!user) throw XentiumError.notFound("User not found");
  const locale = await siteLocale();
  const { text } = templateView(row, locale);

  let type = "", where = "";
  if (opts.target) {
    const info = await describeTarget(opts.target.type, opts.target.id);
    if (!info.authorId || info.authorId !== opts.userId) {
      throw new XentiumError({ code: XEC.MOD_TARGET_MISMATCH, httpStatus: 400, message: "This content is not by the member you are acting on" });
    }
    const kind = targetKind(opts.target.type, opts.target.id);
    type = serverTextOr(locale, `type.${kind}`, kind);
    where = info.where ?? type;
  } else if (/\{(type|where)\}/.test(text)) {
    throw new XentiumError({ code: XEC.MOD_TARGET_REQUIRED, httpStatus: 400, message: "This template names the content, so it needs the content it is about" });
  }

  const banLength = (opts.mode === "ban" ? length : "7d") as (typeof DURATIONS)[number];
  const vars: Record<string, string> = { user: user.username, type, where };
  if (opts.mode === "ban") vars.duration = serverTextOr(locale, `duration.${banLength}`, banLength);
  return { text: fillTemplate(text, vars).trim(), expiry: opts.mode === "warn" ? (length as WarnExpiry | null) : null, length: banLength };
}

/** A ban length as what `issueBan` takes. */
export function banTiming(length: (typeof DURATIONS)[number]) {
  const hours = DURATION_HOURS[length];
  return {
    type: hours === null ? "permanent" as const : "temporary" as const,
    expiresAt: hours === null ? null : new Date(Date.now() + hours * 3_600_000),
  };
}


/** A word from the moderation texts, or the fallback when there is none. */
function serverTextOr(locale: ServerLocale, key: string, fallback: string): string {
  const out = serverText(locale, "moderation", key);
  return out && out !== key ? out : fallback;
}

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
  /** Remove and dismiss only. A warning's or a ban's text is its template's. */
  message:    z.string().trim().min(3).max(2000).optional(),
  notify:     z.boolean().default(true),
  /** Another length than the template's: needs moderation.ban.length.override. */
  duration:   z.enum(DURATIONS).optional(),
  /** Another expiry than the template's: needs moderation.warn.expiry.override. */
  expiry:     z.enum(WARN_EXPIRIES).optional(),
});
export type ActInput = z.infer<typeof actSchema>;

export const templateSchema = z.object({
  mode:            z.enum(MODES),
  name:            z.string().trim().min(1).max(80),
  text:            z.string().trim().min(1).max(2000),
  ruleRef:         z.string().trim().max(80).nullable().optional(),
  defaultDuration: z.enum(DURATIONS).nullable().optional(),
  // null is accepted and means the default length (90 days).
  warnExpiry:      z.enum(WARN_EXPIRIES).nullable().optional(),
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
    // Every warn template carries its length; there is no site-wide rule.
    warnExpiry: t.mode === "warn" ? (t.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
    internal: t.mode === "dismiss",
    matchCategories: t.matchCategories ?? [],
  };
}

function templateView(r: {
  id: string; mode: string; name: string; text: string; ruleRef: string | null; defaultDuration: string | null;
  warnExpiry: string | null; internal: boolean; matchCategories: string[]; useCount: number; updatedAt: Date; defaultKey: string | null;
}, locale: ServerLocale) {
  // A shipped template nobody edited (still its English words) reads in the site's
  // language; an edited one is the admin's text, as they wrote it.
  const english = r.defaultKey ? shipped(r.defaultKey, "en") : null;
  const untouched = !!english && r.name === english.name && r.text === english.text;
  const words = untouched ? shipped(r.defaultKey!, locale) : { name: r.name, text: r.text };
  return {
    id: r.id, mode: r.mode as (typeof MODES)[number], name: words.name, text: words.text, ruleRef: r.ruleRef,
    defaultDuration: r.defaultDuration as (typeof DURATIONS)[number] | null,
    warnExpiry: r.warnExpiry as WarnExpiry | null, internal: r.internal,
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
  if (targetType === "plugin-content") {
    const target = reportTargetRegistry.resolve(targetId);
    if (target?.handler.remove) {
      await target.handler.remove(target.id, { actorId, reason });
      await prisma.moderationLog.create({
        data: { actorId, actorType: "user", action: "plugin_content.deleted", targetType, targetId, reason },
      });
      return;
    }
  }
  throw new XentiumError({
    code: "XEC-API-4001", httpStatus: 400,
    message: "This kind of content can't be removed from here. Open it and use its own tools.",
  });
}
