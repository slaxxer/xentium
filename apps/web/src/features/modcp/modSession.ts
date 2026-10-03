import { useSyncExternalStore } from "react";

/**
 * What the moderator is working through right now, shared by the navbar shield (which
 * starts it) and the action pill (which shows it on the page).
 *
 * A session is the queue as it was when the moderator clicked in, plus where they are
 * in it. Keys, not objects: the pill re-reads the live report/case on every render, so
 * something another moderator already handled simply drops out.
 */
export type ModSession =
  | { kind: "report"; keys: string[]; index: number }
  | { kind: "case"; ids: string[]; index: number }
  /** A plugin's queue (`slotRegistry.registerModQueue`), e.g. forum approvals. */
  | { kind: "queue"; queueId: string; ids: string[]; index: number };

interface State {
  session: ModSession | null;
  /** The shield's dropdown. In the store so `?modcanvas=` and Shift+M can open it. */
  menuOpen: boolean;
  /** A plugin's ModCanvas section, open in its dialog. */
  pluginSection: string | null;
}

let state: State = { session: null, menuOpen: false, pluginSection: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export const modStore = {
  get: () => state,
  startReports: (keys: string[], index: number) => set({ session: { kind: "report", keys, index }, menuOpen: false }),
  startCases: (ids: string[], index: number) => set({ session: { kind: "case", ids, index }, menuOpen: false }),
  startQueue: (queueId: string, ids: string[], index: number) => set({ session: { kind: "queue", queueId, ids, index }, menuOpen: false }),
  /** Move within the session; leaving its end closes it. */
  go: (index: number) => {
    const s = state.session;
    if (!s) return;
    const size = s.kind === "report" ? s.keys.length : s.ids.length;
    set({ session: index >= 0 && index < size ? { ...s, index } : null });
  },
  close: () => set({ session: null }),
  setMenu: (open: boolean) => set({ menuOpen: open }),
  openPlugin: (id: string | null) => set({ pluginSection: id, menuOpen: false }),
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useModStore(): State {
  return useSyncExternalStore(subscribe, modStore.get, modStore.get);
}
