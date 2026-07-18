// Nodevo's own toast system (replaces sweetalert2 toasts — ADR: own the pixels,
// obey the token system). Framework-free store; <ToastHost/> (app root) renders
// it via useSyncExternalStore. Categories: success / info / warning / error,
// plus plugin-registered custom categories (registerToastCategory). Behaviour:
// stacking (max 4 visible + FIFO queue), dedup with ×N counter, per-category
// durations, hover-pause, optional action button. `swalToast` in lib/swal.ts is
// the legacy shim — new code calls `toast.<category>()` directly.

export type CoreToastCategory = "success" | "info" | "warning" | "error";
export type ToastCategory = CoreToastCategory | (string & {});

export interface ToastAction { label: string; onClick: () => void }

export interface ToastOptions {
  title?:    string;
  duration?: number;       // ms; overrides the category default
  action?:   ToastAction;
}

export interface ToastItem {
  id:       number;
  category: ToastCategory;
  message:  string;
  title?:   string;
  action?:  ToastAction;
  duration: number;
  count:    number;        // dedup counter (×N)
  paused:   boolean;
}

/** A plugin-registered category. `color` is any CSS color (use a token var);
 *  `icon` is a FontAwesome IconDefinition (typed loose to stay dep-free). */
export interface ToastCategoryDef {
  id:        string;
  color?:    string;
  icon?:     unknown;
  duration?: number;
}

const DEFAULT_DURATIONS: Record<CoreToastCategory, number> = {
  success: 3500,
  info:    5000,
  warning: 7000,
  error:   10000,
};
const MAX_VISIBLE = 4;
const DEDUP_STATES = true;   // identical (category+message) while visible → ×N

let nextId = 1;
let visible: ToastItem[] = [];
const queue: ToastItem[] = [];
const timers = new Map<number, { handle: ReturnType<typeof setTimeout>; endsAt: number; remaining: number }>();
const listeners = new Set<() => void>();
const busListeners = new Set<(t: ToastItem) => void>();
const categoryDefs = new Map<string, ToastCategoryDef>();

function notify() {
  visible = [...visible];
  for (const fn of listeners) fn();
}

function startTimer(item: ToastItem, ms: number) {
  clearTimer(item.id);
  timers.set(item.id, {
    handle: setTimeout(() => dismiss(item.id), ms),
    endsAt: Date.now() + ms,
    remaining: ms,
  });
}

function clearTimer(id: number) {
  const t = timers.get(id);
  if (t) { clearTimeout(t.handle); timers.delete(id); }
}

function promoteFromQueue() {
  while (visible.length < MAX_VISIBLE && queue.length > 0) {
    const next = queue.shift()!;
    visible.push(next);
    startTimer(next, next.duration);
  }
}

function emit(category: ToastCategory, message: string, opts: ToastOptions = {}): number {
  const def = categoryDefs.get(category);
  const duration = opts.duration
    ?? def?.duration
    ?? DEFAULT_DURATIONS[category as CoreToastCategory]
    ?? DEFAULT_DURATIONS.info;

  if (DEDUP_STATES) {
    const dup = visible.find((t) => t.category === category && t.message === message && t.title === opts.title)
      ?? queue.find((t) => t.category === category && t.message === message && t.title === opts.title);
    if (dup) {
      dup.count += 1;
      if (visible.includes(dup) && !dup.paused) startTimer(dup, dup.duration);   // restart the clock
      notify();
      return dup.id;
    }
  }

  const item: ToastItem = {
    id: nextId++, category, message,
    title: opts.title, action: opts.action, duration, count: 1, paused: false,
  };
  for (const fn of busListeners) fn(item);

  if (visible.length < MAX_VISIBLE) {
    visible.push(item);
    startTimer(item, duration);
  } else {
    queue.push(item);
  }
  notify();
  return item.id;
}

function dismiss(id: number): void {
  clearTimer(id);
  const before = visible.length;
  visible = visible.filter((t) => t.id !== id);
  const qi = queue.findIndex((t) => t.id === id);
  if (qi !== -1) queue.splice(qi, 1);
  if (visible.length < before) promoteFromQueue();
  notify();
}

/** Hover-pause: freeze the dismiss timer (the progress bar pauses via CSS). */
function pause(id: number): void {
  const t = timers.get(id);
  const item = visible.find((v) => v.id === id);
  if (!t || !item || item.paused) return;
  clearTimeout(t.handle);
  t.remaining = Math.max(t.endsAt - Date.now(), 0);
  item.paused = true;
  notify();
}

function resume(id: number): void {
  const t = timers.get(id);
  const item = visible.find((v) => v.id === id);
  if (!t || !item || !item.paused) return;
  item.paused = false;
  startTimer(item, t.remaining);
  notify();
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => emit("success", message, opts),
  info:    (message: string, opts?: ToastOptions) => emit("info", message, opts),
  warning: (message: string, opts?: ToastOptions) => emit("warning", message, opts),
  error:   (message: string, opts?: ToastOptions) => emit("error", message, opts),
  emit,
  dismiss,
  pause,
  resume,
};

// ── Store contract for <ToastHost/> (useSyncExternalStore) ────────────────────
export function subscribeToasts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getToasts(): ToastItem[] {
  return visible;
}

// ── Plugin extension points ───────────────────────────────────────────────────

/** Observe every emitted toast (fires before display; also for queued ones).
 *  Registry-style: plugins subscribe on enable, unsubscribe via the returned fn. */
export function onToast(fn: (t: ToastItem) => void): () => void {
  busListeners.add(fn);
  return () => busListeners.delete(fn);
}

/** Register a custom category (color/icon/duration). Unknown categories render
 *  as `info` otherwise. Idempotent per id. */
export function registerToastCategory(def: ToastCategoryDef): void {
  categoryDefs.set(def.id, def);
}
export function getToastCategoryDef(id: string): ToastCategoryDef | undefined {
  return categoryDefs.get(id);
}

/** Test-only: reset all state. */
export function __resetToasts(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  visible = [];
  queue.length = 0;
  busListeners.clear();
  categoryDefs.clear();
  notify();
}
