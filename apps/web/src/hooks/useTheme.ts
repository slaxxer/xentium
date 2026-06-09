import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "nodevo.theme";

function getStored(): ThemePreference {
  try { return (localStorage.getItem(KEY) as ThemePreference) || "system"; }
  catch { return "system"; }
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
