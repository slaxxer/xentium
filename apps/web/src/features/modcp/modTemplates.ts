/**
 * ModCanvas premade texts: the shapes, how a template is filled in for a report, and
 * which one a report suggests. Pure, so the inspector and the Templates editor agree.
 */

export type Mode = "warn" | "ban" | "delete" | "dismiss";
export type Duration = "1h" | "24h" | "7d" | "30d" | "perm";

export const MODES: Mode[] = ["warn", "ban", "delete", "dismiss"];
const MILDNESS: Record<Mode, number> = { dismiss: 0, warn: 1, delete: 2, ban: 3 };
export const DURATIONS: Duration[] = ["1h", "24h", "7d", "30d", "perm"];

export const MODE_LABEL: Record<Mode, string> = { warn: "Warn", ban: "Ban", delete: "Remove", dismiss: "Dismiss" };
export const DURATION_LABEL: Record<Duration, string> = { "1h": "1h", "24h": "24h", "7d": "7d", "30d": "30d", perm: "Perm." };
/** What `{duration}` reads as inside a message. */
export const DURATION_TEXT: Record<Duration, string> = {
  "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days", perm: "an indefinite period",
};

export interface Template {
  id: string;
  mode: Mode;
  name: string;
  text: string;
  ruleRef: string | null;
  defaultDuration: Duration | null;
  internal: boolean;
  matchCategories: string[];
  useCount: number;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface Vars { user: string; type: string; where: string; duration: string }

/** "article_comment" → "comment". What `{type}` reads as. A plugin's content reads as
 *  its kind — `"xentium-forum:post:<id>"` is a "post" — when the target id is given. */
export function typeLabel(targetType: string, targetId?: string): string {
  if (targetType === "plugin-content" && targetId) {
    const kind = targetId.split(":")[1];
    if (kind) return kind.replace(/[_-]/g, " ");
  }
  if (targetType === "article_comment") return "comment";
  if (targetType === "profile_comment") return "profile comment";
  if (targetType === "user") return "profile";
  return targetType.replace(/[_-]/g, " ");
}

/** A template's text as segments, so a caller can mark the filled-in values. */
export function fillSegments(text: string, vars: Vars): { text: string; filled: boolean }[] {
  return text.split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    const key = m?.[1] as keyof Vars | undefined;
    return key && key in vars ? { text: vars[key], filled: true } : { text: part, filled: false };
  });
}

export function fill(text: string, vars: Vars): string {
  return fillSegments(text, vars).map((s) => s.text).join("");
}

/**
 * The template a report suggests: the one whose categories its reasons mention most,
 * else the most-used one in the default mode. Reasons are free text, so this is a
 * word match, and a moderator overrides it with one click.
 */
export function suggest(templates: Template[], reasons: string[], hasAuthor: boolean): Template | null {
  const hay = reasons.join(" ").toLowerCase();
  let best: Template | null = null;
  let bestScore = 0;
  for (const t of templates) {
    if (!hasAuthor && (t.mode === "warn" || t.mode === "ban")) continue;
    const score = t.matchCategories.filter((c) => hay.includes(c)).length;
    if (score === 0) continue;
    // A tie goes to the MILDER action ("Harassment" warns before "Repeated harassment"
    // bans), then to the more used one — escalating is the moderator's call, not ours.
    const better = !best || score > bestScore
      || (score === bestScore && (MILDNESS[t.mode] < MILDNESS[best.mode]
        || (t.mode === best.mode && t.useCount > best.useCount)));
    if (better) { best = t; bestScore = score; }
  }
  if (best) return best;
  const mode: Mode = hasAuthor ? "warn" : "dismiss";
  return [...templates].filter((t) => t.mode === mode).sort((a, b) => b.useCount - a.useCount)[0] ?? null;
}
