/**
 * ACP drafts: every settings surface on the page registers what it has changed, and
 * ONE save bar (`AcpSaveBar`, mounted in the ACP shell) saves or discards all of it.
 * Nothing goes live until the admin saves.
 *
 * This replaced per-surface autosave. `useAutosave` is now this hook under its old
 * name, so plugin panels written for autosave join the bar without a rebuild — they
 * keep calling `useAutosave({ value, savedValue, onSave })`.
 *
 * ## The rules a surface relies on
 *
 * - **Dirty** = `value` differs from `savedValue` (key-order independent, see
 *   `sameValue`). Idle until `savedValue` is defined.
 * - **Save** calls `onSave(value)`. Return the promise (`mutateAsync`) and the bar
 *   knows exactly when it finished and why it failed. A surface that returns nothing
 *   (shipped plugins call `mutate`) is treated as saved once its `savedValue` catches
 *   up with what was sent, and as failed if it has not within `SETTLE_MS`.
 * - **Discard** calls `onDiscard()` to reset the form. A surface without one is reset
 *   by remounting the page (`useDraftEpoch`), which re-seeds every form from the
 *   server — so discard works for code that never heard of it.
 * - **Outside the ACP shell** (no bar mounted) the hook behaves as the old debounced
 *   autosave: nothing may silently stop saving because the bar is not there.
 */
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { sameValue, stableStringify } from "./autosaveCompare";
import { apiErrorMessage } from "../lib/swal";

export { sameValue, stableStringify };

/** One line in the bar's review list. */
export interface DraftChange {
  /** Stable within its draft — a settings key, say. */
  key: string;
  label: string;
  section?: string;
  /** Formatted for display. */
  from: string;
  to: string;
  /** Put this one change back. Absent = only the whole draft can be discarded. */
  revert?: () => void;
}

export interface DraftError {
  message: string;
  code?: string;
  /** The change that failed (`DraftChange.key`), when the surface can tell. */
  field?: string;
  /** Which draft — so its surface can mark the field and show the section. */
  draftId: string;
}

interface Entry {
  id: string;
  label?: string;
  section?: string;
  dirty: boolean;
  changes?: DraftChange[];
  save: () => Promise<void>;
  discard?: () => void;
}

type Status = "idle" | "saving" | "saved" | "error";

const SETTLE_MS = 15_000;

// ── The store ────────────────────────────────────────────────────────────────

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let status: Status = "idle";
let error: DraftError | null = null;
/** Bumped by a discard that needs remounting; the shell keys the page on it. */
let epoch = 0;
/** How many save bars are mounted — 0 outside the ACP shell. */
let bars = 0;
let snapshot = makeSnapshot();

export interface DraftSnapshot {
  dirtyCount: number;
  changes: DraftChange[];
  /** Ids of the drafts with something unsaved. */
  dirtyIds: string[];
  status: Status;
  error: DraftError | null;
  epoch: number;
}

function changesOf(e: Entry): DraftChange[] {
  if (!e.dirty) return [];
  if (e.changes?.length) return e.changes.map((c) => ({ section: e.section, ...c }));
  // A surface that does not describe its changes counts as one.
  return [{
    key: e.id, label: e.label ?? "", section: e.section, from: "", to: "",
    ...(e.discard ? { revert: e.discard } : {}),
  }];
}

function makeSnapshot(): DraftSnapshot {
  const dirty = [...entries.values()].filter((e) => e.dirty);
  const changes = dirty.flatMap(changesOf);
  return { dirtyCount: changes.length, changes, dirtyIds: dirty.map((e) => e.id), status, error, epoch };
}

function emit(): void {
  snapshot = makeSnapshot();
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** The page's drafts, for the bar, the status chip and section markers. */
export const useDraftStore = (): DraftSnapshot => useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

/** Bumped when a discard has to remount the page. The shell keys its content on it. */
export const useDraftEpoch = (): number => useSyncExternalStore(subscribe, () => epoch, () => 0);

/** The bar announces itself; drafts switch from autosave to waiting for Save. */
export function useSaveBarMounted(): void {
  useEffect(() => {
    bars++;
    emit();
    return () => { bars--; emit(); };
  }, []);
}
const barMounted = () => bars > 0;
const useBarMounted = () => useSyncExternalStore(subscribe, barMounted, () => false);
/** Whether this page has a save bar — false outside the ACP shell. */
export const useHasSaveBar = useBarMounted;

let savedTimer: ReturnType<typeof setTimeout> | undefined;

/** Save every dirty draft. Resolves to whether everything saved. */
export async function saveAll(): Promise<boolean> {
  const dirty = [...entries.values()].filter((e) => e.dirty);
  if (!dirty.length || status === "saving") return status !== "error";
  clearTimeout(savedTimer);
  status = "saving";
  error = null;
  emit();
  const results = await Promise.allSettled(dirty.map((e) => e.save()));
  const failed = results.findIndex((r) => r.status === "rejected");
  if (failed >= 0) {
    const reason = (results[failed] as PromiseRejectedResult).reason as DraftFailure | undefined;
    status = "error";
    error = {
      draftId: dirty[failed]!.id,
      message: reason?.message ?? "",
      ...(reason?.code ? { code: reason.code } : {}),
      ...(reason?.field ? { field: reason.field } : {}),
    };
    emit();
    return false;
  }
  status = "saved";
  emit();
  // "All changes saved", then the bar goes away.
  savedTimer = setTimeout(() => { if (status === "saved") { status = "idle"; emit(); } }, 1800);
  return true;
}

/** Throw this from `onSave` to tell the bar which change failed. */
export class DraftFailure extends Error {
  constructor(message: string, public code?: string, public field?: string) { super(message); }
}

/** Put every draft back to what is saved. */
export function discardAll(): void {
  const dirty = [...entries.values()].filter((e) => e.dirty);
  let remount = false;
  for (const e of dirty) {
    if (e.discard) e.discard();
    else remount = true;
  }
  status = "idle";
  error = null;
  if (remount) epoch++;
  emit();
}

/** Back to clean after an error the admin has dealt with (an edit, a revert). */
function clearErrorFor(id: string): void {
  if (status === "error" && error?.draftId === id) { status = "idle"; error = null; }
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface DraftOptions<T> {
  /** The form's current value. */
  value: T;
  /** What the server has. `undefined` while loading — the draft stays idle. */
  savedValue: T | undefined;
  /** Persist. Return the promise (`mutateAsync`) so the bar can report failures. */
  onSave: (value: T) => unknown;
  /** Reset the form to `savedValue`. Without it, discard remounts the page. */
  onDiscard?: () => void;
  /** Shown in the review list for a draft that does not `describe` itself. */
  label?: string;
  section?: string;
  /** One line per changed field, for the review list and per-field revert. */
  describe?: (value: T, saved: T) => DraftChange[];
  /** Outside the ACP shell only: the autosave debounce. Default 600 ms. */
  delay?: number;
  /** A stable id, when a surface needs to recognise its own error. */
  id?: string;
}

export function useDraft<T>(opts: DraftOptions<T>): void {
  const autoId = useId();
  const id = opts.id ?? autoId;
  const withBar = useBarMounted();
  const latest = useRef(opts);
  latest.current = opts;
  const lastValue = useRef<string | null>(null);

  const valueJson = stableStringify(opts.value);
  const savedJson = opts.savedValue === undefined ? null : stableStringify(opts.savedValue);
  const dirty = savedJson !== null && valueJson !== savedJson;

  // ── With the bar: register, and save only when asked ──────────────────────
  useEffect(() => {
    if (!withBar) return;
    const o = latest.current;
    const prev = entries.get(id);
    const changes = dirty && o.describe && o.savedValue !== undefined ? o.describe(o.value, o.savedValue) : undefined;
    entries.set(id, {
      id, label: o.label, section: o.section, dirty, changes,
      discard: o.onDiscard ? () => latest.current.onDiscard?.() : undefined,
      save: () => saveOne(id),
    });
    // An edit after a failed save is the admin answering it; so is a revert.
    if (!dirty || (prev && lastValue.current !== valueJson)) clearErrorFor(id);
    lastValue.current = valueJson;
    emit();
  }, [withBar, id, dirty, valueJson, savedJson]);

  useEffect(() => () => { entries.delete(id); emit(); }, [id]);

  // ── Without the bar: the old debounced autosave ─────────────────────────────
  const baseline = useRef<string | null>(null);
  useEffect(() => { if (savedJson !== null) baseline.current = savedJson; }, [savedJson]);
  useEffect(() => {
    if (withBar || baseline.current === null || valueJson === baseline.current) return;
    const t = setTimeout(() => {
      baseline.current = valueJson;   // marked saved first, so the refetch cannot re-fire
      void latest.current.onSave(latest.current.value);
    }, opts.delay ?? 600);
    return () => clearTimeout(t);
  }, [withBar, valueJson, savedJson, opts.delay]);

  /** Save this draft; settles when the server has it. */
  function saveOne(entryId: string): Promise<void> {
    const o = latest.current;
    const result = o.onSave(o.value);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(() => undefined, (e: unknown) => { throw toFailure(e); });
    }
    // Fire-and-forget (`mutate`): saved once this draft is clean again.
    return new Promise<void>((resolve, reject) => {
      const done = () => { const e = entries.get(entryId); return !e || !e.dirty; };
      if (done()) return resolve();
      const timer = setTimeout(() => { off(); reject(new DraftFailure("")); }, SETTLE_MS);
      const check = () => { if (done()) { clearTimeout(timer); off(); resolve(); } };
      listeners.add(check);
      const off = () => listeners.delete(check);
    });
  }
}

/** What an API error says, in the shape the bar shows. */
function toFailure(e: unknown): DraftFailure {
  if (e instanceof DraftFailure) return e;
  const code = (e as { detail?: { error?: { code?: string } } })?.detail?.error?.code;
  return new DraftFailure(apiErrorMessage(e), code);
}
