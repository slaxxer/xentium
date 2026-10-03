/**
 * ACP → System → Error log: the shapes the grouped endpoints return, and the
 * small formatting rules the page shares between its parts.
 */
export const SEVERITIES = ["critical", "error", "warn", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type GroupStatus = "open" | "resolved" | "all";
export type Range = "24h" | "7d";

export interface ErrorGroup {
  key: string;
  code: string;
  message: string;
  severity: Severity;
  domain: string;
  count: number;
  userCount: number;
  routeCount: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
  resolvedAt: string | null;
  topRoute: { method: string | null; url: string } | null;
  spark7d: number[];
}

export interface GroupsResponse {
  items: ErrorGroup[];
  counts: Record<GroupStatus, number>;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface Bucket { t: string; critical: number; error: number; warn: number; info: number }

export interface StatsResponse {
  range: Range;
  buckets: Bucket[];
  openGroups: Record<Severity, number>;
  totalEntries: number;
  totalGroups: number;
  domains: string[];
  retentionDays: number;
}

export interface Occurrence {
  id: string;
  method: string | null;
  url: string | null;
  requestId: string | null;
  userId: string | null;
  username: string | null;
  severity: Severity;
  message: string;
  context: unknown;
  createdAt: string;
}

export interface OccurrencesResponse { items: Occurrence[]; nextCursor: string | null; total: number }

export const PAGE_SIZE = 25;

/** Events in a bucket, counting only `only` when a severity filter is on. */
export const bucketTotal = (b: Bucket, only: Severity | null) =>
  only ? b[only] : b.critical + b.error + b.warn + b.info;

/** "Wed, 30.09." / "14:00" in the viewer's locale — the chart's tooltip head. */
export function bucketLabel(t: string, range: Range, locale: string): string {
  const d = new Date(t);
  return range === "7d"
    ? d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" })
    : d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Absolute timestamp for an occurrence, to the second. */
export const fullTime = (t: string, locale: string) =>
  new Date(t).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The day-count "since" line under "last seen": whole days, at least 0. */
export const daysSince = (t: string) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86_400_000));
