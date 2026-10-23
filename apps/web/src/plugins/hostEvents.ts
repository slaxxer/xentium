import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { authStore } from "../lib/authStore";

/**
 * Browser events for plugins: `window.__XENTIUM_HOST__.events.on(name, fn)` → an
 * unsubscribe function. The server has its own, richer set (`ctx.on`); this is
 * what a page plugin needs to follow the page and the signed-in member.
 *
 * A listener that throws is logged and never stops the others. The list only grows
 * in 1.x.
 */
export interface HostEventMap {
  /** The page changed (any navigation, including the first). */
  "route.changed": { path: string; search: string };
  /** Someone signed in, out, or the session was restored. `userId` null = a guest. */
  "auth.changed": { userId: string | null };
}

type Fn = (payload: never) => void;
const listeners = new Map<string, Set<Fn>>();

export const hostEvents = {
  on<K extends keyof HostEventMap>(event: K, fn: (payload: HostEventMap[K]) => void): () => void {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(fn as Fn);
    return () => { set!.delete(fn as Fn); };
  },
  emit<K extends keyof HostEventMap>(event: K, payload: HostEventMap[K]): void {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try { (fn as (p: HostEventMap[K]) => void)(payload); } catch (err) { console.error(`[host events] a "${event}" listener failed`, err); }
    }
  },
};

// Sign-in state: announced when the member changes, not on every token refresh.
let lastUser: string | null | undefined;
authStore.subscribe(() => {
  if (!authStore.loaded) return;
  const id = authStore.user?.id ?? null;
  if (id === lastUser) return;
  lastUser = id;
  hostEvents.emit("auth.changed", { userId: id });
});

/** Mounted once inside the router: announces every navigation. */
export function useRouteEvents(): void {
  const { pathname, search } = useLocation();
  useEffect(() => { hostEvents.emit("route.changed", { path: pathname, search }); }, [pathname, search]);
}
