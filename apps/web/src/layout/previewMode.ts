/**
 * Which preview, if any, this document is.
 *
 * ⚠ Its own module, with NO dependencies, on purpose. These four predicates are read
 * by the icon wrapper, which sits under every icon in the app — importing them from
 * `useLayout` dragged the API client and i18n into that leaf and broke a test suite
 * that had no business knowing about either. A question this small should cost
 * nothing to ask.
 */

/** `?__layout=draft|preview`. */
export const LAYOUT_PREVIEW_PARAM = "__layout";

const DRAFT_MODES = new Set(["draft", "preview"]);

function layoutMode(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(LAYOUT_PREVIEW_PARAM);
}

/** Render the DRAFT rather than what is published. Both modes. */
export function isDraftLayout(): boolean {
  const mode = layoutMode();
  return mode !== null && DRAFT_MODES.has(mode);
}

/**
 * Show the editor's affordances. `draft` only — never `preview`.
 *
 * ⚠ Keep this apart from `isDraftLayout`. They were one predicate, and every new
 * caller had to guess which meaning it wanted; the guess that put editor chrome on
 * a theme preview is the one that made the split necessary.
 */
export function isLayoutPreview(): boolean {
  return layoutMode() === "draft";
}

/** The editor's own preview, by either route it takes. */
export function isEditorPreview(): boolean {
  return typeof window !== "undefined" &&
    (window.location.pathname === "/__theme-preview" || isLayoutPreview());
}
