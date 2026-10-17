/**
 * ACP → Members → Permissions, as data. The page edits a DRAFT and saves
 * on request; this file is the arithmetic behind it, kept pure so it can be
 * tested without rendering.
 *
 * The draft is stored as EDITS on top of what the server holds, never as a copy
 * of it: a refetch (window focus, another tab) moves the baseline under the
 * edits instead of being overwritten by a stale copy, and Save sends exactly
 * the edits as `{grant, revoke}` — a whole replacement set once revoked a grant
 * made after the page opened (see groupPermissionsPatch.test.ts).
 */
import { PERMISSION_IMPLIES } from "@xentium/contracts";

/** groupId → key → wanted state. Only keys the admin touched appear. */
export type Edits = Record<string, Record<string, boolean>>;

export type Change = "grant" | "revoke";

/** The keys a group would hold if the draft were saved. */
export function draftKeys(saved: ReadonlySet<string>, edits: Record<string, boolean> | undefined): Set<string> {
  const out = new Set(saved);
  for (const [k, on] of Object.entries(edits ?? {})) {
    if (on) out.add(k); else out.delete(k);
  }
  return out;
}

/** What saving would do to one key of one group, or null when nothing. */
export function changeOf(saved: ReadonlySet<string>, edits: Record<string, boolean> | undefined, key: string): Change | null {
  const want = edits?.[key];
  if (want === undefined || want === saved.has(key)) return null;
  return want ? "grant" : "revoke";
}

/** The request body for one group: only the keys that differ from the server. */
export function deltaOf(saved: ReadonlySet<string>, edits: Record<string, boolean> | undefined): { grant: string[]; revoke: string[] } {
  const grant: string[] = [];
  const revoke: string[] = [];
  for (const [k, on] of Object.entries(edits ?? {})) {
    if (on && !saved.has(k)) grant.push(k);
    if (!on && saved.has(k)) revoke.push(k);
  }
  return { grant: grant.sort(), revoke: revoke.sort() };
}

/**
 * Set `keys` to `on` in one group's edits. An edit that lands back on the saved
 * state is dropped, so toggling twice leaves the group clean rather than dirty
 * with a no-op.
 */
export function applyEdits(edits: Edits, groupId: string, saved: ReadonlySet<string>, keys: string[], on: boolean): Edits {
  const mine = { ...(edits[groupId] ?? {}) };
  for (const k of keys) {
    if (saved.has(k) === on) delete mine[k];
    else mine[k] = on;
  }
  const next = { ...edits };
  if (Object.keys(mine).length) next[groupId] = mine; else delete next[groupId];
  return next;
}

/** Edits that make a group's draft exactly `target` (Copy from…). */
export function editsToMatch(edits: Edits, groupId: string, saved: ReadonlySet<string>, target: ReadonlySet<string>): Edits {
  const cleared = { ...edits };
  delete cleared[groupId];
  const all = new Set([...saved, ...target]);
  const on = [...all].filter((k) => target.has(k));
  const off = [...all].filter((k) => !target.has(k));
  return applyEdits(applyEdits(cleared, groupId, saved, on, true), groupId, saved, off, false);
}

/** Drop edits the server has since caught up with (a refetch, another admin). */
export function pruneEdits(edits: Edits, savedOf: (groupId: string) => ReadonlySet<string> | undefined): Edits {
  const next: Edits = {};
  for (const [gid, mine] of Object.entries(edits)) {
    const saved = savedOf(gid);
    if (!saved) continue; // the group is gone
    const kept = Object.fromEntries(Object.entries(mine).filter(([k, on]) => saved.has(k) !== on));
    if (Object.keys(kept).length) next[gid] = kept;
  }
  return next;
}

/** The key the group holds that carries `key`, when it does not hold `key` itself. */
export function impliedBy(held: ReadonlySet<string>, key: string): string | null {
  if (held.has(key)) return null;
  for (const [from, to] of Object.entries(PERMISSION_IMPLIES)) {
    if (held.has(from) && to.includes(key)) return from;
  }
  return null;
}

/** Held directly or through an implication — what counts and meters show. */
export function effectiveKeys(held: ReadonlySet<string>): Set<string> {
  const out = new Set(held);
  for (const k of held) for (const implied of PERMISSION_IMPLIES[k] ?? []) out.add(implied);
  return out;
}

/** Everything saving would do, flattened — the save bar's arithmetic. */
export function summarize(edits: Edits, savedOf: (groupId: string) => ReadonlySet<string>): { grants: number; revokes: number; groupIds: string[] } {
  let grants = 0;
  let revokes = 0;
  const groupIds: string[] = [];
  for (const gid of Object.keys(edits)) {
    const d = deltaOf(savedOf(gid), edits[gid]);
    if (!d.grant.length && !d.revoke.length) continue;
    grants += d.grant.length;
    revokes += d.revoke.length;
    groupIds.push(gid);
  }
  return { grants, revokes, groupIds };
}

export type SplitFilter = "all" | "granted" | "off" | "sensitive" | "changed";
export type MatrixFilter = "all" | "sensitive" | "changed";

/** Label or key, case-insensitive; an empty query matches everything. */
export function matchesQuery(p: { key: string; label: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q);
}
