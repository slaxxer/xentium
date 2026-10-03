import { useQueries, useQuery } from "@tanstack/react-query";
import { slotRegistry, type ModQueueItem, type ModQueueSlot } from "../../plugins/slotRegistry";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faFlag, faPlaneDeparture, faRightToBracket, faUserPlus, faUserSecret, faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";

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

const MOD_KEYS = new Set(["admin", "supermod", "moderator"]);
export const isModerator = (groups: { key: string }[] | undefined) => !!groups?.some((g) => MOD_KEYS.has(g.key));

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

/** The reason most reporters gave — a report's title. */
export function topReason(g: ReportGroup): string {
  const tally = new Map<string, number>();
  for (const r of g.reports) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Report";
}

/** Mirrors `humanizeCaseType` in the API's moderation.types.ts. */
export function caseTitle(type: string): string {
  switch (type) {
    case "multi_account_suspicion": return "Multiaccounting";
    case "rapid_login_attempts":    return "Rapid Login";
    case "ban_evasion_suspicion":   return "Ban Evasion";
    case "registration_burst":      return "Registration Burst";
    case "impossible_travel":       return "Impossible Travel";
    default:                        return "Case";
  }
}

/** Mirrors `describeCaseSignal` in the API's moderation.types.ts. */
export function caseSummary(c: ModCase): string {
  const names = c.linkedUsers.map((u) => u.username);
  const who = names.length > 2
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names.join(" and ") || "multiple accounts";
  switch (c.type) {
    case "multi_account_suspicion": return `${who} share the same device cookie`;
    case "rapid_login_attempts":    return `repeated failed logins from the same IP (${who})`;
    case "ban_evasion_suspicion":   return `${who}: new account near a ban from the same IP`;
    case "registration_burst":      return `${names.length || "Several"} accounts registered from the same IP`;
    case "impossible_travel":       return `${who}: logins too far apart to be the same person`;
    default:                        return who;
  }
}

/** The short "why" under a case's title in its pill. */
export function caseReasonShort(type: string): string {
  switch (type) {
    case "multi_account_suspicion": return "Same device cookie";
    case "rapid_login_attempts":    return "Failed logins, same IP";
    case "ban_evasion_suspicion":   return "New account near a ban";
    case "registration_burst":      return "Registrations, same IP";
    case "impossible_travel":       return "Impossible travel";
    default:                        return "Security case";
  }
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

/** A raw signal as a moderator reads it. */
export function humanizeSignal(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("device cookie") || l.includes("shared by"))               return "Shared Device Cookie";
  if (l.includes("failed login"))                                            return "Rapid Failed Logins, Same IP";
  if ((l.includes("within") && l.includes("ban")) || l.includes("evasion"))  return "Possible Ban Evasion";
  if (l.includes("registration") || l.includes("registrations"))            return "Registration Burst, Same IP";
  if (l.includes("same ip") || l.includes("from ip"))                       return "Same IP Address";
  return s;
}

/** "Comment by nightowl · Getting started…" — a report row's second line. */
export function reportLine(g: ReportGroup, type: string): string {
  // A reported PROFILE has no separate author: "theo's profile" says it all.
  if (g.targetType === "user") return g.where ?? "Profile";
  const kind = type.charAt(0).toUpperCase() + type.slice(1);
  const by = g.author ? `${kind} by ${g.author.username}` : kind;
  return g.where ? `${by} · ${g.where}` : by;
}
