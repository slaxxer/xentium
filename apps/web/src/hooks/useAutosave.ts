import { useEffect, useId, useRef, useSyncExternalStore } from "react";

/**
 * JSON with object keys in a stable order.
 *
 * Draft-vs-saved is a deep comparison done by serialising both sides, and the
 * saved side has usually been through Postgres `jsonb` — which stores an
 * object's keys in its own order (shortest first, then bytewise), not the order
 * we wrote them. `JSON.stringify` therefore reports `{icon,label,url}` and
 * `{url,icon,label}` as different drafts, and since saving cannot make the two
 * strings agree, the form saves, refetches, disagrees again, and saves forever.
 * One click on "Add link" in ACP → Settings was measured at 84 PUTs.
 *
 * Sorting keys makes both sides agree. Key order is never meaningful in a
 * settings draft, so this only ever removes saves that should not have fired.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    // Returning a re-keyed object is enough: stringify then walks THIS object,
    // so nested values are sorted on their own visit.
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** True when two drafts hold the same data, whatever order their keys are in. */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

interface AutosaveOptions<T> {
  /** Current draft value (the editable form state). */
  value: T;
  /** Last value known to be persisted on the server (e.g. the query's data).
   *  `undefined` while loading — autosave stays idle until it resolves. */
  savedValue: T | undefined;
  /** Persist the draft. Typically `() => mutation.mutate(value)`. */
  onSave: (value: T) => void;
  /** Debounce window in ms. Default 600. */
  delay?: number;
}

/**
 * Debounced auto-save for ACP settings forms.
 *
 * Saves `value` when it diverges from `savedValue` (deep-compared via JSON with
 * key order normalised — see `stableStringify`), after `delay` ms of quiet,
 * coalescing rapid edits (e.g. typing in number inputs). Behaviour:
 *  - Idle until `savedValue` has loaded (not `undefined`).
 *  - The server value is the baseline; the initial seeded form never triggers a save.
 *  - Marks the snapshot saved *before* invoking `onSave`, so the post-save refetch
 *    that re-syncs the same value cannot cause a save loop.
 *  - The debounce + cleanup means transient intermediate states (e.g. DEFAULTS
 *    briefly differing before the form is seeded) never get persisted.
 *
 * The caller drives the "Saving…" UI from its own `mutation.isPending`.
 */
export function useAutosave<T>({ value, savedValue, onSave, delay = 600 }: AutosaveOptions<T>): void {
  const baselineRef = useRef<string | null>(null);
  const savedJson = savedValue === undefined ? null : stableStringify(savedValue);

  // The server value defines the baseline. Updating it after a successful save
  // (via refetch) keeps the baseline in sync and prevents re-saving.
  useEffect(() => {
    if (savedJson !== null) baselineRef.current = savedJson;
  }, [savedJson]);

  const valueJson = stableStringify(value);
  useEffect(() => {
    if (baselineRef.current === null) return;     // not loaded yet
    if (valueJson === baselineRef.current) return; // unchanged vs persisted
    const t = setTimeout(() => {
      baselineRef.current = valueJson; // mark saved up-front to avoid re-fire
      onSave(value);
    }, delay);
    return () => clearTimeout(t);
  }, [valueJson, savedJson, delay]);
}


// ── Reporting save state UP to a host page ───────────────────────────────────

/**
 * Who is currently saving, by hook-instance id.
 *
 * A panel nested inside a page that ALREADY shows a `SaveChip` — a plugin
 * section on ACP → Settings, say — should not render a second one. It reports
 * instead, and the page's single indicator speaks for everything on it. Two
 * chips on one screen say the same thing twice and can disagree while a save is
 * in flight.
 */
const savers = new Set<string>();
const listeners = new Set<() => void>();
let anySaving = false;

function publish(): void {
  const next = savers.size > 0;
  // Only wake subscribers when the ANSWER changes, not on every report — two
  // panels saving at once must not re-render the page twice.
  if (next === anySaving) return;
  anySaving = next;
  for (const fn of listeners) fn();
}

/**
 * Report this panel's save state to the host page's indicator.
 *
 * Use INSTEAD of rendering a `SaveChip` when the surrounding page already has
 * one. A standalone ACP page — one that owns its own `pg-head` — should still
 * render the chip itself; there is nothing above it to report to.
 */
export function useReportSaving(saving: boolean): void {
  const id = useId();
  useEffect(() => {
    if (saving) savers.add(id); else savers.delete(id);
    publish();
    // Unmounting mid-save must not leave the page stuck reporting "Saving…".
    return () => { savers.delete(id); publish(); };
  }, [id, saving]);
}

/** True while anything on the page has reported itself as saving. */
export function useAnySaving(): boolean {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => anySaving,
    () => false,
  );
}
