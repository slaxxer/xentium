/** ACP dashboard: the `/admin/dashboard/overview` shape and small shared helpers. */
export type MetricId = "members" | "active" | "comments" | "articles";
export const METRICS: MetricId[] = ["members", "active", "comments", "articles"];
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** Each metric's colour, a token so it follows the ACP palette. */
export const METRIC_COLOR: Record<MetricId, string> = {
  members: "var(--c-accent)",
  active: "var(--c-accent2)",
  comments: "var(--c-success)",
  articles: "var(--c-warn)",
};

export interface Metric { total: number; prevTotal: number; values: number[]; compare: number[] }

export type AttentionItem =
  | { kind: "reports"; count: number; oldestAt: string }
  | { kind: "coreUpdate"; from: string; to: string; severity: string | null }
  | { kind: "pluginUpdate"; pluginId: string; name: string; from: string | null; to: string; critical: boolean }
  | { kind: "license"; expired: boolean; daysLeft: number | null; domain: string | null }
  | { kind: "errors"; count: number; codes: Array<{ code: string; count: number }> }
  | { kind: "tasks"; failing: number }
  | { kind: "email" };

export interface Overview {
  range: Range;
  stage: "new" | "active";
  liveSince: string;
  days: string[];
  metrics: Record<MetricId, Metric>;
  totalMembers: number;
  newest: { users: Array<{ id: string; username: string; avatar: string | null }>; count: number };
  attention: AttentionItem[];
  setup: {
    steps: Array<{ key: string; done: boolean; detail?: string | null }>;
    milestones: { members: number; articles: number; comments: number; activeDays: number };
  };
  topArticles: Array<{ id: string; title: string; slug: string; views: number; category: string | null; author: string }>;
  platform: {
    version: string;
    coreUpdate: { from: string; to: string; severity: string | null } | null;
    plugins: { installed: number; updates: number; critical: boolean };
    license: { connected: boolean; grants: number; domain: string | null; expiringSoon: boolean; expired: boolean; daysLeft: number | null; paidPlugins: number };
    tasks: { enabled: number; failing: number; lastRunAt: string | null; runs: string[] };
    errors24h: number;
  };
}

export interface Health {
  db: { status: "ok" | "error"; latencyMs: number };
  redis: { status: "ok" | "error"; latencyMs: number };
  queue: { status: "ok" | "error" };
  storage: { status: "ok" | "error"; writeable: boolean };
  email: { status: "configured" | "unconfigured" | "error" };
  overall: "healthy" | "degraded" | "critical";
}

/** Percent change, or null when there is nothing to compare with. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

/** 4.8k style, for the chart axis and view counts. */
export function compact(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Axis top that reads well: 1, 2, 5, 10, 20, 50… */
export function niceMax(v: number): number {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** "YYYY-MM-DD" (a local day from the server) → "Sep 4" in the viewer's locale. */
export function dayLabel(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(locale, { month: "short", day: "numeric" });
}
