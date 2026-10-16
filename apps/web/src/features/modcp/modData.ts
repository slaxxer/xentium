import { userCan, type AuthUser } from "../../lib/authStore";
import { useQueries, useQuery } from "@tanstack/react-query";
import { slotRegistry, type ModQueueItem, type ModQueueSlot } from "../../plugins/slotRegistry";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faFlag, faPlaneDeparture, faRightToBracket, faUserPlus, faUserSecret, faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import i18n from "../../lib/i18n";

// ── Wire types ────────────────────────────────────────────────────────────────

interface Ref { id: string; username: string; badgeColor: string | null; avatar?: string | null }
export interface LadderStep { warningCount: number; action: "notify" | "ban_temporary" | "ban_permanent"; banDays?: number }

/** One reported thing and every open report on it (GET /moderation/inspector). */
export interface ReportGroup {
  key: string;
  targetType: string;
  targetId: string;
  where: string | null;
  href: string | null;
  /** Core can remove this content (its own kinds, or a plugin that offers removal). */
  canRemove: boolean;
  snapshot: string | null;
  firstReportedAt: string;
  latestAt: string;
  reports: { id: string; reason: string; createdAt: string; reporter: Ref }[];
  author: (Ref & {
    joinedAt: string; activeWarnings: number; ladderSize: number;
    nextStep: LadderStep | null; otherOpenReports: number;
  }) | null;
  claimedBy: { id: string; username: string } | null;
}

/** An open security case (GET /moderation/cases). */
export interface ModCase {
  id: string; type: string; severity: string; status: string;
  signals: string[]; linkedUserIds: string[];
  linkedUsers: { id: string; username: string; badgeColor: string | null }[];
  ipAddresses: string[]; createdAt: string;
}

export interface ModSummary { pendingReports: number; openCases: number; activeWarnings: number; activeBans: number }

/** Works the moderation queues: reports or review cases (ACP → Permissions). */
export const isModerator = (user: AuthUser | null | undefined) =>
  userCan(user, "moderation.report.manage") || userCan(user, "moderation.cases.manage");

// ── Queries ───────────────────────────────────────────────────────────────────
// Oldest first everywhere: the dropdown says "Oldest waits longest", and a session
// walks the queue in the same order the moderator saw it.

const byOldest = <T,>(at: (x: T) => string) => (a: T, b: T) => at(a).localeCompare(at(b));

export function useReportGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["canvas-inspector"],
    queryFn: () => api.get<{ data: ReportGroup[]; total: number }>("/moderation/inspector"),
    select: (r) => [...(r?.data ?? [])].sort(byOldest((g) => g.firstReportedAt)),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });
}

export function useOpenCases(enabled: boolean) {
  return useQuery({
    queryKey: ["canvas-cases"],
    queryFn: () => api.get<{ data: ModCase[]; meta: { total: number } }>("/moderation/cases?limit=50"),
    select: (r) => [...(r?.data ?? [])].filter((c) => c.status === "open").sort(byOldest((c) => c.createdAt)),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });
}

/**
 * Every plugin queue and its items, oldest first. Polled while the site is open, so
 * the shield's dot counts them too. A queue that fails to load is treated as empty —
 * one plugin's outage must not take the moderation list down with it.
 */
export function useModQueues(enabled: boolean): { queue: ModQueueSlot; items: ModQueueItem[]; loading: boolean }[] {
  const queues = slotRegistry.getModQueues();
  const results = useQueries({
    queries: queues.map((q) => ({
      queryKey: ["mod-queue", q.id],
      queryFn: () => q.fetchItems().catch(() => [] as ModQueueItem[]),
      enabled,
      refetchInterval: enabled ? 60_000 : false as const,
      select: (items: ModQueueItem[]) => [...items].sort(byOldest((i) => i.createdAt)),
    })),
  });
  return queues.map((queue, i) => ({ queue, items: results[i]?.data ?? [], loading: !!results[i]?.isLoading }));
}

// ── Labels ────────────────────────────────────────────────────────────────────
// Read through the shared i18n instance: these are called from render, so they
// follow the moderator's language the same way `t()` in a component does.

const tr = (key: string, opts?: Record<string, unknown>) => String(i18n.t(`common:modcanvas.data.${key}`, opts as never));

/** The reason most reporters gave — a report's title. Reporters' own words, untranslated. */
export function topReason(g: ReportGroup): string {
  const tally = new Map<string, number>();
  for (const r of g.reports) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tr("report");
}

const CASE_TYPES = ["multi_account_suspicion", "rapid_login_attempts", "ban_evasion_suspicion", "registration_burst", "impossible_travel"];
const known = (type: string) => CASE_TYPES.includes(type) ? type : "other";

/** Mirrors `humanizeCaseType` in the API's moderation.types.ts. */
export function caseTitle(type: string): string {
  return tr(`caseTitle.${known(type)}`);
}

/** Mirrors `describeCaseSignal` in the API's moderation.types.ts. */
export function caseSummary(c: ModCase): string {
  const names = c.linkedUsers.map((u) => u.username);
  const who = names.length > 2
    ? tr("who.list", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] })
    : names.length === 2 ? tr("who.pair", { a: names[0], b: names[1] })
    : names[0] ?? tr("who.multiple");
  if (c.type === "registration_burst") {
    return names.length ? tr("caseSummary.registration_burst", { count: names.length }) : tr("caseSummary.registration_burst_unknown");
  }
  return CASE_TYPES.includes(c.type) ? tr(`caseSummary.${c.type}`, { who }) : who;
}

/** The short "why" under a case's title in its pill. */
export function caseReasonShort(type: string): string {
  return tr(`caseReason.${known(type)}`);
}

/** A case's severity (low | medium | high) in the moderator's language. */
export function severityLabel(severity: string): string {
  return i18n.exists(`common:modcanvas.data.severity.${severity}`) ? tr(`severity.${severity}`) : severity;
}

export function caseIcon(type: string): IconDefinition {
  switch (type) {
    case "multi_account_suspicion": return faUsers;
    case "ban_evasion_suspicion":   return faUserSecret;
    case "rapid_login_attempts":    return faRightToBracket;
    case "registration_burst":      return faUserPlus;
    case "impossible_travel":       return faPlaneDeparture;
    default:                        return faFlag;
  }
}

/** A raw signal as a moderator reads it. Unrecognised ones are shown as stored. */
export function humanizeSignal(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("device cookie") || l.includes("shared by"))               return tr("signal.deviceCookie");
  if (l.includes("failed login"))                                            return tr("signal.failedLogins");
  if ((l.includes("within") && l.includes("ban")) || l.includes("evasion"))  return tr("signal.banEvasion");
  if (l.includes("registration") || l.includes("registrations"))            return tr("signal.registrations");
  if (l.includes("same ip") || l.includes("from ip"))                       return tr("signal.sameIp");
  return s;
}

/**
 * What kind of thing was reported, in the moderator's language. NOT `typeLabel`:
 * that one fills `{type}` inside the admin-written message the MEMBER receives, and
 * must stay in the language those texts are written in.
 */
export function targetTypeLabel(targetType: string, targetId?: string): string {
  if (targetType === "plugin-content" && targetId) {
    const kind = targetId.split(":")[1];
    if (kind) return kind.replace(/[_-]/g, " ");
  }
  return i18n.exists(`common:modcanvas.data.types.${targetType}`) ? tr(`types.${targetType}`) : targetType.replace(/[_-]/g, " ");
}

/** "Comment by nightowl · Getting started…" — a report row's second line. */
export function reportLine(g: ReportGroup, type: string): string {
  // A reported PROFILE has no separate author: "theo's profile" says it all.
  if (g.targetType === "user") return g.where ?? tr("profile");
  const kind = type.charAt(0).toUpperCase() + type.slice(1);
  const by = g.author ? tr("by", { kind, user: g.author.username }) : kind;
  return g.where ? `${by} · ${g.where}` : by;
}
