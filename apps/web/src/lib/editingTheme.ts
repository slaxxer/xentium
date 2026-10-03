/**
 * Which theme an Appearance editor is editing.
 *
 * Every theme — each installed one, and the built-in Core theme — carries its own
 * layouts, colours, fonts, custom CSS and site frame. The Layout Editor and the Style
 * Editor edit one of them at a time, named in their URL as `?theme=<id>` (`_core` for
 * Core). Absent = the theme the site is wearing, which is what both editors edited
 * before there was a choice — and what the API assumes when it is not told.
 *
 * The editors' preview iframes are real site routes, so they carry the choice in their
 * own URL as `__theme=` and render THAT theme's draft.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** How Core is named in a query string — not a valid theme id, so it cannot collide. */
export const CORE_THEME_PARAM = "_core";

/** The editors' own URL parameter. */
export const EDITING_THEME_PARAM = "theme";

/** The preview iframe's parameter. */
export const PREVIEW_THEME_PARAM = "__theme";

/** `url` with `theme=<key>` appended, or unchanged when the key is the default. */
export function withTheme(url: string, key: string | null): string {
  if (key === null) return url;
  return `${url}${url.includes("?") ? "&" : "?"}theme=${encodeURIComponent(key)}`;
}

/** The theme being edited, from the editor page's URL. `null` = the active theme. */
export function useEditingTheme(): { key: string | null; setKey: (next: string | null) => void } {
  const [params, setParams] = useSearchParams();
  const key = params.get(EDITING_THEME_PARAM);
  const setKey = useCallback((next: string | null) => {
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (next === null) out.delete(EDITING_THEME_PARAM);
      else out.set(EDITING_THEME_PARAM, next);
      return out;
    }, { replace: true });
  }, [setParams]);
  return { key, setKey };
}

/** In a preview iframe: the theme it is previewing, or `null` for the active one. */
export function previewThemeKey(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PREVIEW_THEME_PARAM);
}
