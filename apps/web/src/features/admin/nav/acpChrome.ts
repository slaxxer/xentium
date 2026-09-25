import { useSyncExternalStore } from "react";

/**
 * The ACP shell's own preferences: which navigation chrome it wears, and
 * whether the section panel is docked or collapsed to the rail.
 *
 * This is a per-admin, per-browser working preference — like the ACP's
 * light/dark toggle, and stored the same way. It is deliberately NOT a site
 * setting: the chrome an admin drives the panel with is theirs, not the site's
 * design, and two admins on one install may want different ones.
 *
 * A module-level store rather than context, because the rail, the panel, the
 * utility bar and the user menu all read it and none of them is an ancestor of
 * the others.
 */

export type AcpChromeLayout = "rail" | "horizontal";

const LAYOUT_KEY = "xentium.acp.layout";
const COLLAPSED_KEY = "xentium.acp.railCollapsed";

/** Below this the panel is never docked — it opens as a flyout on demand.
 *  248 (panel) + 72 (rail) leaves too little for a table otherwise. */
export const PANEL_DOCK_MIN_WIDTH = 1100;

function readLayout(): AcpChromeLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "horizontal" ? "horizontal" : "rail";
  } catch { return "rail"; }
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; }
  catch { return false; }
}

let _layout: AcpChromeLayout = readLayout();
let _collapsed = readCollapsed();
const _listeners = new Set<() => void>();

function emit() { _listeners.forEach((fn) => fn()); }
function subscribe(fn: () => void) { _listeners.add(fn); return () => { _listeners.delete(fn); }; }

export function setAcpLayout(layout: AcpChromeLayout): void {
  if (_layout === layout) return;
  _layout = layout;
  try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* private mode */ }
  emit();
}

export function setAcpCollapsed(collapsed: boolean): void {
  if (_collapsed === collapsed) return;
  _collapsed = collapsed;
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* private mode */ }
  emit();
}

function getLayout() { return _layout; }
function getCollapsed() { return _collapsed; }

export function useAcpLayout(): AcpChromeLayout {
  return useSyncExternalStore(subscribe, getLayout, getLayout);
}

export function useAcpCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getCollapsed, getCollapsed);
}
