/**
 * The site's FontAwesome kit, and the style it draws in.
 *
 * Xentium bundles the FREE solid set and always will: with no kit, or a kit that
 * fails to load, every icon in the app still draws from the bundle. A kit is
 * additive — it is how an admin with their own Pro subscription gets Pro icons and
 * Pro styles on their own instance.
 *
 * ⚠ Each instance brings its OWN licence. A Pro licence covers the sites its owner
 * operates, and Xentium is installed by strangers on their own servers, so Pro
 * artwork can never be bundled into the build — that would copy licensed assets into
 * every install. A kit is fetched at runtime with the admin's own id and is
 * domain-locked by FontAwesome to their site. Full rationale: `docs/icon-kits.md`.
 *
 * ⚠ This is a STORE, not a pair of getters, and that is load-bearing. The kit script
 * arrives after the first paint — there is no server render to put it in the HTML —
 * so components that mounted before it landed must be told to draw again. Without a
 * subscription the app would keep its free icons until something unrelated happened
 * to re-render it, which reads as "the setting did nothing".
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_STYLE, isIconStyle, iconStyleClasses } from "@xentium/contracts";

/** Mirrors the server's allowlist. See `modules/appearance/iconKit.ts`. */
const KIT_URL = /^https:\/\/kit\.fontawesome\.com\/[a-z0-9]{6,32}\.js$/;

const CACHE_KEY = "xentium.iconKit";

/** Is this a kit, as the server will judge it? Mirrors `modules/appearance/iconKit.ts`. */
export function looksLikeKit(raw: string): boolean {
  const v = raw.trim();
  return /^[a-z0-9]{6,32}$/.test(v) || KIT_URL.test(v);
}

// ── The store ───────────────────────────────────────────────────────────────

export interface IconKitState {
  /** True only once the kit script has actually LOADED, never merely requested. */
  ready: boolean;
  style: string;
}

let state: IconKitState = { ready: false, style: DEFAULT_ICON_STYLE };
const listeners = new Set<() => void>();

function setState(next: Partial<IconKitState>): void {
  const merged = { ...state, ...next };
  if (merged.ready === state.ready && merged.style === state.style) return;
  state = merged;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getSnapshot = () => state;

/**
 * What a component should draw with right now.
 *
 * Returns `null` whenever the bundled free set should be used — no kit, kit not
 * loaded yet, or the admin chose `solid`. A caller that gets null must render
 * exactly what it rendered before any of this existed.
 */
export function useIconStyle(): string | null {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!s.ready) return null;
  return iconStyleClasses(s.style);
}

/** Non-reactive read, for the few places outside React. */
export function iconKitReady(): boolean {
  return state.ready;
}

/**
 * Whether the kit can draw, as a SUBSCRIPTION.
 *
 * ⚠ `iconKitReady()` read during render does not re-render when the script lands.
 * Anything deciding between a kit class and a bundled icon must use this, or it
 * settles on "no kit" on first paint and stays there.
 */
export function useIconKitReady(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).ready;
}

// ── Loading ─────────────────────────────────────────────────────────────────

let requested: string | null = null;

function inject(url: string): void {
  // ⚠ Re-checked here, not trusted from storage. A cached value is only as good as
  // the browser it came from, and this string becomes a script source.
  if (requested || !KIT_URL.test(url)) return;
  requested = url;
  const el = document.createElement("script");
  el.src = url;
  el.crossOrigin = "anonymous";
  el.async = true;
  // ⚠ `ready` flips on LOAD, not on append. Claiming a style before the kit can
  // draw it is how you get a page of blank squares instead of icons.
  el.addEventListener("load",  () => setState({ ready: true }));
  el.addEventListener("error", () => { /* offline, blocked, bad id — free set stands */ });
  document.head.appendChild(el);
}

/**
 * Inject from the last known value, then confirm with the server.
 *
 * ⚠ The cache is what stops the icons visibly swapping on every visit. The app is a
 * static SPA, so without it the kit could only be requested after the config
 * round-trip and every load would start free and change under the reader.
 *
 * A kit or style that has CHANGED takes effect on the next load; a script that has
 * executed cannot be unloaded. Nothing here is awaited: no part of the app's boot
 * should wait on a third-party script.
 */
export function startIconKit(): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { url, style } = JSON.parse(cached) as { url?: string; style?: string };
      if (isIconStyle(style)) setState({ style });
      if (url) inject(url);
    }
  } catch { /* private mode, blocked or corrupt storage — the fetch below still runs */ }

  void fetch("/api/appearance/branding", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { iconKitUrl?: string | null; iconStyle?: string | null } | null) => {
      const url   = data?.iconKitUrl ?? null;
      const style = isIconStyle(data?.iconStyle) ? data!.iconStyle : DEFAULT_ICON_STYLE;
      try {
        if (url) localStorage.setItem(CACHE_KEY, JSON.stringify({ url, style }));
        else localStorage.removeItem(CACHE_KEY);
      } catch { /* nothing to do; this load still works */ }
      setState({ style });
      if (url) inject(url);
    })
    .catch(() => { /* offline or installing — the bundled free set still draws */ });
}

/** Test seam. Not used by the app. */
export function __setIconKitState(next: Partial<IconKitState>): void {
  setState(next);
}
