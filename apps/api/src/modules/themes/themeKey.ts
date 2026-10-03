/**
 * Which theme an appearance read or write is about.
 *
 * Every theme — each installed one, and the built-in CORE theme — carries its own
 * layouts, tokens, custom CSS, fonts and site frame, edited on its own. A THEME KEY
 * names one: `''` is Core, anything else is an installed theme's id. Switching the
 * site's theme changes which key is live; nothing is copied between them.
 *
 * Deliberately free of the appearance and layout services: both import this, and the
 * theme service imports both of them.
 */
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { getFreshSetting } from "../../shared/utils/settings.js";
import type { LayoutDocument, SiteFrame } from "@xentium/contracts";
import type { ScopedTokenSet } from "@xentium/contracts";

export type ThemeKey = string;

/** The built-in theme: code-default layouts and the bundled tokens. */
export const CORE_THEME: ThemeKey = "";

/**
 * How Core is named in a query string. Not a valid theme id (ids start with a letter
 * or digit), so no installed theme can ever be mistaken for it.
 */
export const CORE_PARAM = "_core";

/** The manifest of the active theme; absent = Core is live. */
export const ACTIVE_THEME_SETTING = "appearance.theme.installed";

/** The settings key for a per-theme value: Core keeps the historical key unchanged. */
export const themed = (base: string, key: ThemeKey): string => (key ? `${base}@${key}` : base);

/** The theme visitors get. */
export async function activeThemeKey(): Promise<ThemeKey> {
  const active = await getFreshSetting<Record<string, unknown> | null>(ACTIVE_THEME_SETTING, null);
  return active?.id ? String(active.id) : CORE_THEME;
}

/**
 * The theme an ADMIN request is editing, from `?theme=`.
 *
 * Absent = the active theme, which is what every editor opened before it had a picker.
 * A key naming nothing installed is refused rather than silently editing something else.
 */
export async function resolveEditingKey(raw: unknown): Promise<ThemeKey> {
  if (raw === undefined || raw === null || raw === "") return activeThemeKey();
  if (typeof raw !== "string") throw badKey();
  if (raw === CORE_PARAM) return CORE_THEME;
  const row = await prisma.theme.findUnique({ where: { id: raw }, select: { id: true } });
  if (!row) throw badKey(raw);
  return raw;
}

/** For a VISITOR's `?theme=`: an unknown id quietly means the active theme. */
export async function resolveViewingKey(raw: unknown): Promise<ThemeKey> {
  if (typeof raw !== "string" || !raw) return activeThemeKey();
  if (raw === CORE_PARAM) return CORE_THEME;
  const row = await prisma.theme.findUnique({ where: { id: raw }, select: { id: true } });
  return row ? raw : activeThemeKey();
}

function badKey(raw?: string): XentiumError {
  return new XentiumError({
    code: XEC.API_VALIDATION, httpStatus: 422,
    message: raw ? `No installed theme "${raw}".` : "Invalid theme.",
    persist: false,
  });
}

// ── What a theme SHIPS (its baseline) ───────────────────────────────────────

/** A theme package in applicable form — see `ThemePayload` in theme.service. */
export interface ThemeBaseline {
  documents: Record<string, LayoutDocument>;
  tokens:    ScopedTokenSet;
  customCss: string;
  frame:     SiteFrame | null;
}

const EMPTY: ThemeBaseline = { documents: {}, tokens: {}, customCss: "", frame: null };

/**
 * Per theme id. A payload only changes when the theme is reinstalled, which busts it,
 * so this never expires on its own.
 */
const baselineMemo = new Map<string, ThemeBaseline>();

export function bustThemeBaseline(id?: string): void {
  if (id) baselineMemo.delete(id);
  else baselineMemo.clear();
}

/**
 * What the theme shipped. Core ships nothing — its baseline is the code itself.
 *
 * A payload from before the collapse to one palette may still carry `{light, dark}`
 * tokens; the light half is the one that ever rendered, so it is the one kept.
 */
export async function themeBaseline(key: ThemeKey): Promise<ThemeBaseline> {
  if (!key) return EMPTY;
  const hit = baselineMemo.get(key);
  if (hit) return hit;
  const row = await prisma.theme.findUnique({ where: { id: key }, select: { payload: true } });
  const p = (row?.payload ?? {}) as {
    documents?: Record<string, LayoutDocument>; tokens?: unknown; customCss?: unknown; frame?: unknown;
  };
  const rawTokens = p.tokens as Record<string, unknown> | null | undefined;
  const tokens = rawTokens && typeof rawTokens === "object" && ("light" in rawTokens || "dark" in rawTokens)
    ? (rawTokens.light ?? {}) as ScopedTokenSet
    : (rawTokens ?? {}) as ScopedTokenSet;
  const out: ThemeBaseline = {
    documents: p.documents ?? {},
    tokens,
    customCss: typeof p.customCss === "string" ? p.customCss : "",
    frame:     (p.frame ?? null) as SiteFrame | null,
  };
  baselineMemo.set(key, out);
  return out;
}
