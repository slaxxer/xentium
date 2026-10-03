/**
 * Theme Studio's modes and links. Its own module so the pages that link INTO the
 * Studio (Themes, the Theme style tab) don't import the Studio page, which imports
 * them back.
 */
import { withTheme } from "../../../lib/editingTheme";

export const STUDIO_MODES = ["layout", "style", "branding", "css", "history"] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];

/** Studio link for one theme (`null` = the live one) and mode. */
export function studioHref(key: string | null, mode: StudioMode = "layout"): string {
  return withTheme(mode === "layout" ? "/admin/theme-studio" : `/admin/theme-studio?mode=${mode}`, key);
}
