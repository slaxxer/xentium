/**
 * ACP → System → Migration History, as data. Everything the page derives from
 * the rows lives here, pure, so it can be tested without rendering.
 */

export type RunStatus = "running" | "completed" | "partial" | "failed";
/** What the page shows: a "running" row whose heartbeat stopped is `stalled`. */
export type EffectiveStatus = RunStatus | "stalled";

export interface RunProgress {
  at: string;
  current: string | null;
  entities: Record<string, { done: number; total: number }>;
}

export interface MigrationRun {
  id:          string;
  adapter:     string;            // "core" = schema deploy; otherwise platform adapter
  adapterVer:  string | null;
  sourceInfo:  string | null;     // e.g. "XenForo 2.2.14"
  status:      RunStatus;
  command:     string | null;
  durationMs:  number | null;
  output:      string | null;
  startedAt:   string | null;
  completedAt: string | null;
  summary:     Record<string, number> | null;
  errors:      Array<{ entity?: string; sourceId?: string; reason?: string }> | null;
  progress:    RunProgress | null;
  reportPath:  string | null;
  createdAt:   string;
}

export interface SchemaStatus {
  total:         number;
  applied:       number;
  pending:       string[];
  failed:        string[];
  lastAppliedAt: string | null;
}

export interface HistoryResponse {
  runs:   MigrationRun[];
  schema: SchemaStatus | null;
}

/** The runner writes a heartbeat every 5s; two minutes of silence is a dead process. */
export const STALE_AFTER_MS = 2 * 60_000;

export function effectiveStatus(run: MigrationRun, now: number): EffectiveStatus {
  if (run.status !== "running") return run.status;
  const beat = run.progress?.at ? Date.parse(run.progress.at) : NaN;
  return Number.isFinite(beat) && now - beat <= STALE_AFTER_MS ? "running" : "stalled";
}

export const isCore = (run: MigrationRun) => run.adapter === "core";
export const startedOf = (run: MigrationRun) => new Date(run.startedAt ?? run.createdAt);

/** Live while running; up to the last heartbeat for a dead run; stored otherwise. */
export function durationOf(run: MigrationRun, status: EffectiveStatus, now: number): number | null {
  if (status === "running") return now - startedOf(run).getTime();
  if (status === "stalled" && run.progress?.at) return Date.parse(run.progress.at) - startedOf(run).getTime();
  return run.durationMs;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** `pnpm --filter @xentium/migrate-wp migrate -- …` → `@xentium/migrate-wp`. */
export function packageOf(run: MigrationRun): string {
  const hit = run.command?.match(/--filter\s+(\S+)/);
  return hit?.[1] ?? `@xentium/migrate-${run.adapter}`;
}

/**
 * The loader counts in camelCase plurals (`forumNodes`) and reports failures in
 * snake_case singulars (`forum_node`). One key for both, so an entity's count
 * and its issues carry the same name.
 */
export function entityKey(raw: string): string {
  const camel = raw.replace(/[_\s]+([a-z])/g, (_, c: string) => c.toUpperCase());
  const aliases: Record<string, string> = {
    user: "users", category: "categories", article: "articles", comment: "comments",
    forumNode: "forumNodes", thread: "threads", post: "posts", postLike: "postLikes",
    follow: "follows", block: "blocks", attachment: "attachments",
  };
  return aliases[camel] ?? camel;
}

/** The order the loader works through entities (migrate-core loader.loadAll). */
export const ENTITY_ORDER = [
  "users", "categories", "articles", "comments", "forumNodes", "threads", "posts",
  "blocks", "follows", "postLikes", "attachments",
] as const;

/**
 * Keys in load order. ⚠ Never trust the object's own key order: the rows are
 * `jsonb`, and Postgres normalises keys (shortest first), so `posts` would come
 * back ahead of `users`.
 */
export function inLoadOrder(keys: string[]): string[] {
  const rank = (k: string) => {
    const i = (ENTITY_ORDER as readonly string[]).indexOf(entityKey(k));
    return i === -1 ? ENTITY_ORDER.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ── Schema-deploy output ────────────────────────────────────────────────────

export interface CoreAnalysis {
  found:      number | null;
  applied:    number;
  /** The migration that failed, from Prisma's "Migration name:" line. */
  failedName: string | null;
  /** 1-based line of the database's own error, for the jump link. */
  errorLine:  number | null;
  errorText:  string | null;
  nothingToApply: boolean;
}

export function analyseCore(output: string): CoreAnalysis {
  const lines = output.split("\n");
  const found = output.match(/(\d+) migrations? found/);
  const failedName = output.match(/Migration name: (\S+)/)?.[1] ?? null;
  const idx = lines.findIndex((l) => /^ERROR:/.test(l.trim()));
  return {
    found: found ? Number(found[1]) : null,
    applied: (output.match(/^Applying migration/gm) ?? []).length,
    failedName,
    errorLine: idx >= 0 ? idx + 1 : null,
    errorText: idx >= 0 ? lines[idx]!.trim().replace(/^ERROR:\s*/, "") : null,
    nothingToApply: /No pending migrations/.test(output),
  };
}

// ── The run list ────────────────────────────────────────────────────────────

export type TypeFilter = "all" | "core" | "import";
export type StatusFilter = "all" | EffectiveStatus;

export interface Filters { q: string; type: TypeFilter; status: StatusFilter }

export function matchesType(run: MigrationRun, type: TypeFilter): boolean {
  return type === "all" || (type === "core" ? isCore(run) : !isCore(run));
}

export function matchesQuery(run: MigrationRun, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [run.command, run.adapter, packageOf(run), run.sourceInfo, run.output]
    .filter(Boolean).join(" ").toLowerCase().includes(needle);
}

/** Calendar-day groups, in the order the runs arrive (newest first). */
export function groupByDay<T>(items: T[], dayOf: (item: T) => Date): Array<{ day: Date; items: T[] }> {
  const groups: Array<{ day: Date; items: T[] }> = [];
  for (const item of items) {
    const day = dayOf(item);
    const last = groups[groups.length - 1];
    if (last && last.day.toDateString() === day.toDateString()) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

// ── Issues ──────────────────────────────────────────────────────────────────

export interface IssueGroup {
  entity:  string;
  reasons: string[];
  items:   Array<{ sourceId: string; reason: string }>;
}

export function groupIssues(errors: MigrationRun["errors"]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const e of errors ?? []) {
    const entity = entityKey(e.entity ?? "run");
    const reason = e.reason ?? "";
    const group = groups.get(entity) ?? { entity, reasons: [], items: [] };
    if (!group.reasons.includes(reason)) group.reasons.push(reason);
    group.items.push({ sourceId: e.sourceId ?? "", reason });
    groups.set(entity, group);
  }
  const order = inLoadOrder([...groups.keys()]);
  return order.map((k) => groups.get(k)!);
}

// ── The log ─────────────────────────────────────────────────────────────────

export type Tone = "error" | "warn" | "ok" | "strong" | "info" | "noise" | "blank";

/** How a line reads. Noise is tooling chatter that says nothing about the run. */
export function toneOf(line: string): Tone {
  const s = line.trim();
  if (!s) return "blank";
  if (/^npm (notice|warn)|^◇ injected env|^\[dotenv/.test(s)) return "noise";
  if (/^(Error:|ERROR:|error:)|failed to apply|^Database error/.test(s)) return "error";
  if (/^warn(ing)?:|^! |\b\d+ issues\b/i.test(s)) return "warn";
  if (/successfully applied|No pending migrations|✔|^Done in/.test(s)) return "ok";
  if (/^(Applying migration|Loading |Importing |Extracting |Migration name:|Source:|@xentium\/|Recount|Recomput)/.test(s)) return "strong";
  return "info";
}

export type LogRow =
  | { kind: "line"; n: number; text: string; tone: Tone; hit: boolean }
  | { kind: "fold"; count: number };

export interface LogView {
  rows:    LogRow[];
  total:   number;
  hidden:  number;
  matches: number;
}

/**
 * The lines to draw. With `hideNoise`, noise folds into one "N hidden" row per
 * run of it and blank lines vanish — unless the search hits them, because a
 * search that finds nothing visible is worse than noise.
 */
export function buildLog(output: string, opts: { hideNoise: boolean; q: string }): LogView {
  const raw = output ? output.split("\n") : [];
  const needle = opts.q.trim().toLowerCase();
  const rows: LogRow[] = [];
  let hidden = 0;
  let matches = 0;
  let fold: { kind: "fold"; count: number } | null = null;

  raw.forEach((text, i) => {
    const tone = toneOf(text);
    const hit = !!needle && text.toLowerCase().includes(needle);
    if (hit) matches += countOccurrences(text.toLowerCase(), needle);
    if (opts.hideNoise && (tone === "noise" || tone === "blank") && !hit) {
      hidden++;
      if (tone === "blank") return;
      if (fold) fold.count++;
      else { fold = { kind: "fold", count: 1 }; rows.push(fold); }
      return;
    }
    fold = null;
    rows.push({ kind: "line", n: i + 1, text, tone, hit });
  });

  return { rows, total: raw.length, hidden, matches };
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}
