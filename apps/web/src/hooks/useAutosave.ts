import { useEffect, useRef } from "react";

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
 * Saves `value` when it diverges from `savedValue` (deep-compared via JSON),
 * after `delay` ms of quiet — coalescing rapid edits (e.g. typing in number
 * inputs). Behaviour:
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
  const savedJson = savedValue === undefined ? null : JSON.stringify(savedValue);

  // The server value defines the baseline. Updating it after a successful save
  // (via refetch) keeps the baseline in sync and prevents re-saving.
  useEffect(() => {
    if (savedJson !== null) baselineRef.current = savedJson;
  }, [savedJson]);

  const valueJson = JSON.stringify(value);
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
