// Promise-based confirm/alert dialogs (replaces sweetalert2 modals). Store only —
// <DialogHost/> in the app root renders the active dialog. One dialog at a time;
// a second openDialog() while one is open resolves the first as cancelled.
import type { ReactNode } from "react";

export type DialogIcon = "question" | "success" | "info" | "warning" | "error" | "update";

/** One line in a panel dialog's detail list (label left, value right). */
export interface PanelRow {
  label:   string;   // e.g. a plugin's display name
  value?:  string;   // e.g. "1.0.3 → 1.0.4"
  marker?: string;   // short danger-styled tag on the row, e.g. "critical"
}

export interface DialogOptions {
  kind:         "confirm" | "alert";
  icon:         DialogIcon;
  title:        string;
  body?:        string;
  /** Rich body content (JSX) — used instead of `body` when provided. */
  bodyNode?:    ReactNode;
  confirmText?: string;
  cancelText?:  string;
  /** Style the confirm button as destructive (danger). */
  danger?:      boolean;
  // ── Panel extras (announcement-style dialogs; see openPanelDialog) ────────
  /** Danger-styled pill next to the title, e.g. "Critical update". */
  badge?:       string;
  /** Structured detail rows rendered as a list. */
  rows?:        PanelRow[];
  /** Warn-colored footer note, e.g. "License renewal required". */
  note?:        string;
  /** Wider, left-aligned announcement layout. */
  wide?:        boolean;
}

export interface ActiveDialog extends DialogOptions { id: number }

let nextId = 1;
let active: ActiveDialog | null = null;
let resolver: ((ok: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

/** Open a dialog; resolves true on confirm, false on cancel/dismiss (alerts
 *  always resolve true when acknowledged). */
export function openDialog(opts: DialogOptions): Promise<boolean> {
  resolver?.(false);   // pre-empt any open dialog as cancelled
  active = { ...opts, id: nextId++ };
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    notify();
  });
}

/**
 * Announcement-style panel dialog — the app-wide "something needs your
 * attention" surface (plugin updates, critical notices, …). Wide, left-aligned,
 * with an optional badge, structured detail rows, and a footer note. Same
 * store/host as confirm/alert (one at a time, Escape dismisses, Enter
 * confirms). Resolves true on the primary action.
 */
export function openPanelDialog(opts: Omit<DialogOptions, "kind" | "wide"> & { kind?: "confirm" | "alert" }): Promise<boolean> {
  return openDialog({ kind: opts.kind ?? "confirm", ...opts, wide: true });
}

export function resolveDialog(ok: boolean): void {
  const r = resolver;
  active = null;
  resolver = null;
  notify();
  r?.(ok);
}

// Store contract for <DialogHost/> (useSyncExternalStore).
export function subscribeDialog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getDialog(): ActiveDialog | null {
  return active;
}
