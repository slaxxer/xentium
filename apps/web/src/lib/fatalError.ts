import { useSyncExternalStore } from "react";

/**
 * Global fatal-error state. When the API returns a server-class failure
 * (HTTP >= 500), the API client trips this store and the app renders a
 * non-dismissible full-screen halt overlay (WoltLab style). The only way out
 * is a reload — recovery is intentional, not a soft dismiss.
 */
export interface FatalError {
  code: string;       // NEC code, e.g. "NEC-API-5000"
  message: string;    // human-ish message from the server (generic in prod)
  severity: string;   // "error" | "critical"
  status: number;     // HTTP status
  at: number;         // timestamp
}

let _fatal: FatalError | null = null;
const _listeners = new Set<() => void>();

function emit() {
  for (const l of _listeners) l();
}

export const fatalErrorStore = {
  /** Trip the halt. First error wins — later errors don't overwrite the screen. */
  trigger(e: Omit<FatalError, "at">) {
    if (_fatal) return; // already halted
    _fatal = { ...e, at: Date.now() };
    emit();
  },
  /** Clear the halt (used only by an explicit reset; the overlay reloads instead). */
  clear() {
    if (!_fatal) return;
    _fatal = null;
    emit();
  },
  subscribe(listener: () => void) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },
  getSnapshot() {
    return _fatal;
  },
};

export function useFatalError(): FatalError | null {
  return useSyncExternalStore(fatalErrorStore.subscribe, fatalErrorStore.getSnapshot);
}
