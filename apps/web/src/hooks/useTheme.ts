/**
 * The STAFF TOOLS' light/dark preference. Not the site's.
 *
 * ⚠ This used to theme everything. It no longer reaches the public site at all: a site
 * has ONE look — the theme's — and `tokens.scss` defines exactly one palette with no
 * `prefers-color-scheme` anywhere in the render path. A reader who wants a different
 * look picks a different THEME, from the chooser in the footer.
 *
 * What is left is the ACP and the ModCP, which deliberately opt OUT of the site's
 * palette (`body.xt-acp` re-declares the whole thing) and keep their own. They are
 * tools, not part of anyone's design, so a dark one is a working preference rather than
 * a second version of the site — which is why this hook survives the collapse while the
 * navbar toggle, the installer's toggle and the account preference did not.
 *
 * It still writes `data-theme` on the root element, because that is the attribute those
 * two surfaces' stylesheets key off. Nothing the site serves reads it.
 */
import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "xentium.theme";

// Light until the admin flips the toggle (2026-10-19): the tools open in their light
// look, never in whatever the device happens to prefer.
function getStored(): ThemePreference {
  try { return (localStorage.getItem(KEY) as ThemePreference) || "light"; }
  catch { return "light"; }
}

function getSystemTheme(): ResolvedTheme {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  catch { return "light"; }
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref;
}

// Simple module-level store so all instances stay in sync
let _pref: ThemePreference = getStored();
const _listeners = new Set<() => void>();

function setPref(p: ThemePreference) {
  _pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  document.documentElement.dataset.theme = resolve(p);
  _listeners.forEach((fn) => fn());
}

function getSnapshot() { return _pref; }
function subscribe(fn: () => void) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Apply on load
if (typeof document !== "undefined") {
  document.documentElement.dataset.theme = resolve(_pref);
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, getSnapshot);
  const theme = resolve(preference);

  // Re-resolve when system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (_pref === "system") {
        document.documentElement.dataset.theme = resolve("system");
        _listeners.forEach((fn) => fn());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return {
    theme,
    preference,
    setPreference: setPref,
    toggle: () => setPref(theme === "dark" ? "light" : "dark"),
  };
}
