// Promise-based confirm/alert dialogs (replaces sweetalert2 modals). Store only —
// <DialogHost/> in the app root renders the active dialog. One dialog at a time;
// a second openDialog() while one is open resolves the first as cancelled.
import type { ReactNode } from "react";

export type DialogIcon = "question" | "success" | "info" | "warning" | "error";

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
