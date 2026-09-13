import { prisma } from "../../infrastructure/db.js";
import postcss from "postcss";
import { HEARTH_DEFAULT_TOKENS, XEC, SCOPE_SELECTOR, fontRootDecls, fontBodyRule, type TokenMap, type TokenSet, type ThemeScope, type ScopedTokens, type ScopedTokenSet } from "@xentium/contracts";
import { XentiumError } from "../../shared/errors/XentiumError.js";
// Appearance reads bypass the settings TTL cache on purpose: a client refetching
// /css right after a cross-process style publish must never get stale tokens.
import { bustSettingsCache, getFreshSetting as readSetting } from "../../shared/utils/settings.js";
import { publishStyleVersion } from "./appearance.sse.js";

export type ThemeName = "light" | "dark";

// ScopedTokens / ScopedTokenSet now live in @xentium/contracts (shared with the
// Style Editor). Re-exported below for existing importers of this module.
export type { ScopedTokens, ScopedTokenSet };

// Back-compat shim: legacy storage is a flat TokenMap (string values); the new
// shape is scope→map (object values). Normalise either into the scoped shape.
/**
 * Overlay one scoped token set on another, per scope and per token.
 *
 * `over` wins. Both sides are sparse, and the result stays sparse: this is a merge of
 * OVERRIDES, not a fill from defaults, so a token nobody set is still absent and still
 * inherits through `tokens.scss`.
 */
function mergeLayers(base: ScopedTokenSet, over: ScopedTokenSet): ScopedTokenSet {
  const out: ScopedTokenSet = { light: {}, dark: {} };
  for (const theme of ["light", "dark"] as ThemeName[]) {
    const scopes = new Set([...Object.keys(base[theme]), ...Object.keys(over[theme])]);
    for (const scope of scopes) {
      const merged = { ...(base[theme][scope] ?? {}), ...(over[theme][scope] ?? {}) };
      if (Object.keys(merged).length > 0) out[theme][scope] = merged;
    }
  }
  return out;
}

function normalizeScoped(value: unknown): ScopedTokens {
  if (!value || typeof value !== "object") return {};
  const obj  = value as Record<string, unknown>;
  const vals = Object.values(obj);
  if (vals.length === 0) return {};
  const isScoped = vals.every((v) => v !== null && typeof v === "object");
  return isScoped ? (obj as ScopedTokens) : { global: obj as TokenMap };
}

// Each theme's custom CSS is scoped under the matching root attribute. This both
// (a) targets only the chosen theme and (b) raises every rule's specificity above
// the app's single-class (BEM) rules, so an admin's override actually wins. Light
// uses :not([data-theme="dark"]) so it also covers the pre-hydration default.
const THEME_SCOPE: Record<ThemeName, string> = {
  light: ':root:not([data-theme="dark"])',
  dark:  ':root[data-theme="dark"]',
};

// Prefix every top-level (and @media/@supports/@layer-nested) style-rule selector
// with the theme scope. @keyframes step rules, @font-face and nested rules are left
// untouched so animations/fonts still work. Invalid CSS is dropped (returns "")
// rather than corrupting the whole served stylesheet.
//
// ⚠ The site's CSS stops at the admin panel. Custom CSS is the SITE's design, and
// the ACP is not part of it — an `a { color }` or a `body { background }` written
// for the site was landing on the admin panel too, the same complaint the palette
// pin answers (`body.nv-acp`, apps/web/src/styles/_tokenDefaults.scss). So every
// rule is anchored under `body:not(.nv-acp)`: the ACP puts that class on <body>
// while it is mounted and takes it off on the way out.
//
// ⚠ `:root` / `html` rules are the exception and stay document-wide, because a rule
// on the root element cannot be qualified by a class on its child without `:has()`,
// and an unsupported selector would silently drop the admin's ENTIRE stylesheet
// rather than one rule. In practice those rules declare TOKENS, which the ACP
// re-declares over anyway — what remains is html-level paint.
const SITE_BODY = "body:not(.nv-acp)";

// Apply the theme scope to one selector. Selectors that target the root element
// (`:root` / `html`) get the scope MERGED onto them (compound) so a custom
// `:root { --c-accent: red }` actually overrides the palette token — prefixing as
// a descendant (`scope :root`) would match nothing. A selector for `body` itself is
// merged onto the ACP exclusion for the same reason. Everything else is a descendant.
function scopeSelector(sel: string, prefix: string): string {
  const t = sel.trim();
  if (t === ":root" || t === "html") return prefix;
  // `:root.x` / `html.x` / `:root[x]` / `:root:hover` → keep the trailing compound
  const m = t.match(/^(?::root|html)((?:[.#:[]|::).*)$/);
  if (m) return prefix + m[1];
  // `body`, `body.x`, `body > .y` — compounded onto the exclusion, never `body body`.
  const b = t.match(/^body((?:[.#:[]|::)[^\s>+~]*)?([\s>+~][\s\S]*)?$/);
  if (b) return `${prefix} ${SITE_BODY}${b[1] ?? ""}${b[2] ?? ""}`;
  return `${prefix} ${SITE_BODY} ${t}`;
}

// Admin-authored CSS is attacker-adjacent input. `map: false` takes postcss's
// early-out before it resolves a /*# sourceMappingURL */ comment, which would
// otherwise read an arbitrary `.map` path off the server's disk (GHSA postcss
// #42/#57). Version-independent — keep it even though we ship a patched postcss.
const PARSE_OPTS = { map: false } as const;

function scopeCustomCss(css: string, theme: ThemeName): string {
  if (!css.trim()) return "";
  const prefix = THEME_SCOPE[theme];
  let root: postcss.Root;
  try {
    root = postcss.parse(css, PARSE_OPTS);
  } catch {
    return "";
  }
  root.walkRules((rule) => {
    const p = rule.parent;
    const scopable =
      !p ||
      p.type === "root" ||
      (p.type === "atrule" && /^(media|supports|layer)$/i.test((p as postcss.AtRule).name));
    if (!scopable) return; // nested rule or @keyframes step — leave as authored
    rule.selectors = rule.selectors.map((s) => scopeSelector(s, prefix));
  });
  return root.toString();
}

// Reject unparseable CSS at SAVE time so an admin gets an error instead of the
// blob being silently dropped by scopeCustomCss() when the stylesheet is built.
function assertParsableCss(css: string, theme: ThemeName): void {
  if (!css.trim()) return;
  try {
    postcss.parse(css, PARSE_OPTS);
  } catch (err) {
    throw new XentiumError({
      code: XEC.API_VALIDATION,
      httpStatus: 400,
      message: `Custom CSS (${theme}) has a syntax error: ${err instanceof Error ? err.message : "invalid CSS"}`,
    });
  }
}

// Scoped result of both themes' custom CSS, compiled at save time. Cached in a
// setting so GET /api/appearance/css (public hot path, refetched by every open
// client on each style-version bump) never runs a postcss parse per request.
const CUSTOM_CSS_COMPILED_KEY = "appearance.custom_css_compiled";

// Staged (draft) token overrides — the Style Editor writes here; they go live only
// on publish (Run now or the scheduled appearance-publish job). Live tokens stay in
// appearance.tokens.{light,dark}; /css serves live, never the draft.
const DRAFT_LIGHT_KEY = "appearance.tokens.draft.light";
const DRAFT_DARK_KEY  = "appearance.tokens.draft.dark";
const DRAFT_BY_KEY    = "appearance.tokens.draft.by"; // user id who last edited the draft

// ── Theme layer (inheritance) ────────────────────────────────────────────────
// What an imported `.nvtheme` shipped, kept SEPARATE from the admin's own overrides.
// That separation is the whole of token inheritance: the served stylesheet is the theme
// merged UNDER the admin's edits, so re-importing a newer version of the theme replaces
// this layer and every tweak the admin made survives — per token, not per file.
//
// The alternative (importing straight into the admin layer) is what XenForo and WoltLab
// both make you live with: customise a purchased style and an update either clobbers your
// work or you never take the update.
const THEME_LIGHT_KEY = "appearance.tokens.theme.light";
const THEME_DARK_KEY  = "appearance.tokens.theme.dark";
// An import STAGES the theme layer, exactly as an admin's own edits are staged: a theme
// changes every page at once, which is precisely the change to preview before committing.
// Promoted by the same `publishDraft` — one "publish appearance" verb, not two.
const THEME_DRAFT_LIGHT_KEY = "appearance.tokens.theme.draft.light";
const THEME_DRAFT_DARK_KEY  = "appearance.tokens.theme.draft.dark";
/** The manifest of the installed theme, so the ACP can name what it is inheriting from. */
const THEME_INSTALLED_KEY = "appearance.theme.installed";
/** One level of undo for the last theme import — see `saveThemeRollback`. */
const THEME_ROLLBACK_KEY = "appearance.theme.rollback";

// ── Theme layer: custom CSS ──────────────────────────────────────────────────
// Custom CSS was the one channel a theme did NOT layer. An import called
// `saveCustomCss` with the package's contents, which overwrote the admin's own
// stylesheet outright — unrecoverably, since unlike a layout no baseline was recorded,
// and unlike a token there was nowhere else for it to live. A package shipping only
// `custom-light.css` even blanked the admin's DARK css, because both keys were always
// written together.
//
// So the theme's CSS gets its own layer, mirroring the token layer exactly: staged by an
// import, promoted by the same `publishDraft`, and emitted BEFORE the admin's CSS so
// that on an equally-specific rule the admin still wins. `resetAppearance` leaves it
// alone for the same reason it leaves the token layer alone.
const THEME_CSS_LIGHT_KEY = "appearance.custom_css.theme.light";
const THEME_CSS_DARK_KEY  = "appearance.custom_css.theme.dark";
const THEME_CSS_DRAFT_LIGHT_KEY = "appearance.custom_css.theme.draft.light";
const THEME_CSS_DRAFT_DARK_KEY  = "appearance.custom_css.theme.draft.dark";

/**
 * The served custom-CSS blob: the THEME layer first, the admin's own after it.
 *
 * Order is the whole of the inheritance. Both layers are scoped to the same theme root,
 * so two rules of equal specificity are decided by source order — putting the admin
 * last means their stylesheet wins exactly the way their tokens do, and a theme update
 * can never take a customisation away.
 */
function compileCustomCss(
  admin: { light: string; dark: string },
  theme: { light: string; dark: string },
): string {
  return [
    scopeCustomCss(theme.light, "light"),
    scopeCustomCss(theme.dark,  "dark"),
    scopeCustomCss(admin.light, "light"),
    scopeCustomCss(admin.dark,  "dark"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Editable semantic token defaults — single shared copy in @xentium/contracts,
// also consumed by the web Style Editor. tokens.scss stays the rendering truth.
export const DEFAULT_TOKENS = HEARTH_DEFAULT_TOKENS;

export type { TokenMap, TokenSet };

/** The appearance half of a theme-import rollback: setting key → prior value,
 *  where `null` means the setting did not exist and must be deleted again. */
export type ThemeLayerSnapshot = Record<string, unknown>;

/** Everything needed to put the site back the way it was before the last import. */
export interface ThemeRollback {
  /** Type-only import: erased at compile time, so naming the layout service's row
   *  shape here cannot create a runtime cycle between the two modules. */
  layouts:  import("../layouts/layout.service.js").LayoutRowSnapshot[];
  layers:   ThemeLayerSnapshot;
  /** The theme that was installed before, for the ACP to name in the undo button. */
  replaced: string | null;
  at:       string;
}

// Live-sync defaults. The interval is how often each open client polls the
// version endpoint; clamped so a misconfigured value can't hammer the API or
// stall propagation. Default 5s → theme changes reach every client within ~5s.
const LIVE_REFRESH_DEFAULT_SECONDS = 5;
const LIVE_REFRESH_MIN_SECONDS     = 2;
const LIVE_REFRESH_MAX_SECONDS     = 60;

/**
 * Built CSS per installed theme, for visitors wearing one.
 *
 * Keyed by theme id alone and never expired: a theme's payload is immutable once
 * installed — changing it means installing a new version, which replaces the row —
 * so unlike the live sheet there is no version to invalidate against. Cleared on
 * uninstall so a removed theme cannot go on being served from memory.
 */
const themeCssMemo = new Map<string, string>();

/** Forget a theme's built stylesheet — call when its row changes or goes away. */
export function bustThemeCss(themeId?: string): void {
  if (themeId) themeCssMemo.delete(themeId);
  else themeCssMemo.clear();
}

// Latest built live CSS, keyed by style version (per process; see getLiveCss).
let liveCssMemo: { version: number; css: string } | null = null;

export const appearanceService = {
  // Monotonic-ish marker bumped on every change that affects the served CSS.
  // Clients poll getStyleVersion() and refetch the CSS only when it changes.
  async bumpStyleVersion(): Promise<void> {
    const version = Date.now();
    await prisma.setting.upsert({
      where:  { key: "appearance.style_version" },
      update: { value: version },
      create: { key: "appearance.style_version", value: version },
    });
    // Push the change to every connected client across all processes (SSE fan-out).
    await publishStyleVersion(version);
  },

  async getStyleVersion(): Promise<number> {
    return readSetting<number>("appearance.style_version", 0);
  },

  /** The served live stylesheet, memoized on the style version: every change
   *  that affects output bumps the version (bumpStyleVersion), so one cheap
   *  version read replaces the full token-load + build on repeat requests. */
  async getLiveCss(): Promise<string> {
    const version = await this.getStyleVersion();
    if (liveCssMemo && liveCssMemo.version === version) return liveCssMemo.css;
    const css = await this.buildCSS(await this.getEffectiveTokens());
    liveCssMemo = { version, css };
    return css;
  },

  /**
   * The stylesheet for ONE INSTALLED THEME, for a visitor wearing it.
   *
   * ⚠ The theme's OWN tokens, with no admin layer over them. The admin's overrides
   * were authored against the site's active theme — a colour chosen to sit on that
   * theme's surface has no meaning on another one, and merging the two produces a
   * palette neither theme has. A visitor choosing a theme gets it as its author
   * shipped it; the site's own visitors get the site, admin edits and all.
   *
   * Returns null when the id names nothing installed, so the caller can fall back to
   * the live sheet rather than serve a blank one: a cookie outlives an uninstall.
   */
  async getThemeCss(themeId: string): Promise<string | null> {
    const cached = themeCssMemo.get(themeId);
    if (cached) return cached;

    /*
     * ⚠ Read straight from the row, NOT through `themeService`. That module already
     * imports this one (activation applies tokens through `appearanceService`), so
     * calling back the other way would close an import cycle for the sake of one
     * `findUnique`.
     */
    const row = await prisma.theme.findUnique({
      where: { id: themeId }, select: { payload: true },
    });
    const payload = (row?.payload ?? null) as { tokens?: unknown } | null;
    if (!payload?.tokens) return null;

    const raw = payload.tokens as { light?: unknown; dark?: unknown };
    const css = await this.buildCSS({
      light: normalizeScoped(raw.light),
      dark:  normalizeScoped(raw.dark),
    });
    themeCssMemo.set(themeId, css);
    return css;
  },

  async getLiveRefreshSeconds(): Promise<number> {
    const raw = await readSetting<number>("appearance.live_refresh_seconds", LIVE_REFRESH_DEFAULT_SECONDS);
    const n   = Number(raw);
    if (!Number.isFinite(n)) return LIVE_REFRESH_DEFAULT_SECONDS;
    return Math.min(LIVE_REFRESH_MAX_SECONDS, Math.max(LIVE_REFRESH_MIN_SECONDS, Math.round(n)));
  },

  // ── Custom CSS console ──────────────────────────────────────────────────────
  // Raw CSS authored by an admin (trusted boundary, admin.access only), per theme.
  // Scoped + appended after the token blocks in the served stylesheet so it can
  // override anything. Served as text/css (never injected as HTML), so there is no
  // XSS vector beyond what a site admin can already do.
  async getCustomCss(): Promise<{ light: string; dark: string }> {
    const [light, dark, legacy] = await Promise.all([
      // null = the per-theme key was NEVER written; "" = explicitly cleared.
      readSetting<string | null>("appearance.custom_css_light", null),
      readSetting<string | null>("appearance.custom_css_dark",  null),
      readSetting<string>("appearance.custom_css", ""), // pre-theme single blob
    ]);
    // Fall back to the old single blob ONLY if Light was never saved per-theme —
    // not when it was deliberately cleared (otherwise clearing Light wouldn't stick).
    return { light: light ?? legacy, dark: dark ?? "" };
  },

  async saveCustomCss(css: { light: string; dark: string }): Promise<void> {
    assertParsableCss(css.light, "light");
    assertParsableCss(css.dark, "dark");
    // Recompiled against the LIVE theme layer, not a blank one: this writes the whole
    // served blob, so dropping the theme half here would silently uninstall a theme's
    // stylesheet the first time an admin touched their own.
    const compiled = compileCustomCss(css, await this.getThemeCustomCss());
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: "appearance.custom_css_light" },
        update: { value: css.light },
        create: { key: "appearance.custom_css_light", value: css.light },
      }),
      prisma.setting.upsert({
        where:  { key: "appearance.custom_css_dark" },
        update: { value: css.dark },
        create: { key: "appearance.custom_css_dark", value: css.dark },
      }),
      prisma.setting.upsert({
        where:  { key: CUSTOM_CSS_COMPILED_KEY },
        update: { value: compiled },
        create: { key: CUSTOM_CSS_COMPILED_KEY, value: compiled },
      }),
    ]);
    await this.bumpStyleVersion();
  },

  /** Both layers, both themes, scoped and ready to append to the stylesheet. */
  async buildCustomCss(): Promise<string> {
    const compiled = await readSetting<string | null>(CUSTOM_CSS_COMPILED_KEY, null);
    if (compiled !== null) return compiled;
    // Raw CSS saved before compile-on-save existed (or the legacy single blob):
    // compile once and persist so subsequent /css requests skip postcss entirely.
    return this.recompileCustomCss();
  },

  /** The same blob a publish would produce, built from the STAGED theme layer.
   *  Never cached: a draft changes on every import and is read only by a preview. */
  async buildDraftCustomCss(): Promise<string> {
    const [admin, theme] = await Promise.all([this.getCustomCss(), this.getThemeDraftCustomCss()]);
    return compileCustomCss(admin, theme);
  },

  /**
   * Rebuild and cache the served blob from whatever both layers currently hold.
   *
   * The cache is a single setting on the public hot path (`GET /appearance/css`), so
   * every writer of EITHER layer has to come through here — a theme publish that
   * skipped it would leave the site serving the previous theme's stylesheet until an
   * admin happened to save their own CSS.
   */
  async recompileCustomCss(): Promise<string> {
    const [admin, theme] = await Promise.all([this.getCustomCss(), this.getThemeCustomCss()]);
    const result = compileCustomCss(admin, theme);
    await prisma.setting.upsert({
      where:  { key: CUSTOM_CSS_COMPILED_KEY },
      update: { value: result },
      create: { key: CUSTOM_CSS_COMPILED_KEY, value: result },
    });
    bustSettingsCache(CUSTOM_CSS_COMPILED_KEY);
    return result;
  },

  // ── Theme layer: custom CSS ───────────────────────────────────────────────

  /** What the installed theme's stylesheet is, LIVE. Empty when nothing is published. */
  async getThemeCustomCss(): Promise<{ light: string; dark: string }> {
    const [light, dark] = await Promise.all([
      readSetting<string | null>(THEME_CSS_LIGHT_KEY, null),
      readSetting<string | null>(THEME_CSS_DARK_KEY,  null),
    ]);
    return { light: light ?? "", dark: dark ?? "" };
  },

  /** The staged theme stylesheet, falling back to the live one when nothing is staged. */
  async getThemeDraftCustomCss(): Promise<{ light: string; dark: string }> {
    const [light, dark] = await Promise.all([
      readSetting<string | null>(THEME_CSS_DRAFT_LIGHT_KEY, null),
      readSetting<string | null>(THEME_CSS_DRAFT_DARK_KEY,  null),
    ]);
    if (light === null && dark === null) return this.getThemeCustomCss();
    return { light: light ?? "", dark: dark ?? "" };
  },

  /**
   * Stage an imported theme's stylesheet. Nothing served changes until publish.
   *
   * Both keys are written even when the package carries only one, because "this theme
   * has no dark stylesheet" is a fact about the theme that has to replace the previous
   * theme's dark stylesheet. That is safe here in a way it never was against the admin's
   * keys: this layer belongs to the theme, so overwriting all of it is correct.
   */
  /** The theme's stylesheet, LIVE and mirrored into the draft — same reasoning as
   *  `saveThemeTokens`, and it must stay in step with it: a theme whose colours went
   *  live while its stylesheet waited for a publish is a look it never had. */
  async saveThemeCustomCss(css: { light: string; dark: string }): Promise<void> {
    const put = (key: string, value: string) => prisma.setting.upsert({
      where: { key }, update: { value }, create: { key, value },
    });

    await prisma.$transaction([
      put(THEME_CSS_LIGHT_KEY, css.light),
      put(THEME_CSS_DARK_KEY,  css.dark),
      put(THEME_CSS_DRAFT_LIGHT_KEY, css.light),
      put(THEME_CSS_DRAFT_DARK_KEY,  css.dark),
    ]);
    for (const key of [THEME_CSS_LIGHT_KEY, THEME_CSS_DARK_KEY,
                       THEME_CSS_DRAFT_LIGHT_KEY, THEME_CSS_DRAFT_DARK_KEY]) {
      bustSettingsCache(key);
    }
    // The served blob is a cached setting on a public hot path — every writer of
    // either layer comes through here, or the site keeps serving the old stylesheet.
    await this.recompileCustomCss();
  },

  /** Scope a single raw blob for one theme — used by the live-preview endpoint. */
  scopeCss(css: string, theme: ThemeName): string {
    return scopeCustomCss(css, theme);
  },

  // Editor display: the SPARSE scope-keyed overrides exactly as saved (ADR-0003).
  // The editor renders inherit↔override from this: a token present in a bucket is
  // an explicit override; one that is absent is inherited (resolves via tokens.scss
  // `var(--base)`), and the editor sources its display fallback from the registry /
  // HEARTH_DEFAULT_TOKENS. Returning the raw sparse map (not merged with defaults)
  // is what lets the editor distinguish the two states.
  // The Style Editor edits the DRAFT. Returns draft overrides, falling back to the
  // live overrides when no draft has been started yet (so opening the editor shows
  // the current live theme as the starting point).
  async getTokens(): Promise<ScopedTokenSet> {
    return this.getDraftTokens();
  },

  async getDraftTokens(): Promise<ScopedTokenSet> {
    const [light, dark] = await Promise.all([
      readSetting<unknown>(DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(DRAFT_DARK_KEY,  null),
    ]);
    if (light === null && dark === null) return this.getTokenOverrides(); // no draft → live
    return { light: normalizeScoped(light), dark: normalizeScoped(dark) };
  },

  // Save editor changes to the draft only — no version bump, no SSE push, no
  // history entry. Nothing reaches the public site until publishDraft(). Records
  // the editing admin so a scheduled (SYSTEM) publish can attribute the history entry.
  async saveDraftTokens(tokens: ScopedTokenSet, savedById: string): Promise<void> {
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: DRAFT_LIGHT_KEY },
        update: { value: tokens.light as unknown as object },
        create: { key: DRAFT_LIGHT_KEY, value: tokens.light as unknown as object },
      }),
      prisma.setting.upsert({
        where:  { key: DRAFT_DARK_KEY },
        update: { value: tokens.dark as unknown as object },
        create: { key: DRAFT_DARK_KEY, value: tokens.dark as unknown as object },
      }),
      prisma.setting.upsert({
        where:  { key: DRAFT_BY_KEY },
        update: { value: savedById },
        create: { key: DRAFT_BY_KEY, value: savedById },
      }),
    ]);
  },

  /**
   * Merge ONE scope's overrides into the draft.
   *
   * The Layout Editor's variant panel is a second writer of the same draft, and a
   * read-modify-write of the WHOLE token set from two surfaces loses whichever edit
   * landed first. So this patches a single bucket server-side: a `null` value clears
   * that token, and a bucket left empty is deleted rather than stored as `{}` — the
   * storage is sparse by design, and "pending" is a stringify comparison.
   */
  async saveDraftScope(
    scope: string,
    patch: { light?: Record<string, string | null>; dark?: Record<string, string | null> },
    savedById: string,
  ): Promise<ScopedTokenSet> {
    const draft = await this.getDraftTokens();
    const next: ScopedTokenSet = { light: { ...draft.light }, dark: { ...draft.dark } };

    for (const theme of ["light", "dark"] as ThemeName[]) {
      const changes = patch[theme];
      if (!changes) continue;
      const bucket: TokenMap = { ...(next[theme][scope] ?? {}) };
      for (const [cssVar, value] of Object.entries(changes)) {
        if (value === null) delete bucket[cssVar];
        else bucket[cssVar] = value;
      }
      if (Object.keys(bucket).length === 0) delete next[theme][scope];
      else next[theme][scope] = bucket;
    }

    await this.saveDraftTokens(next, savedById);
    return next;
  },

  /**
   * Is there anything staged that differs from what is live?
   *
   * BOTH layers count. A freshly imported theme has no admin-layer changes at all, so
   * checking only that would report "nothing to publish" straight after an import and
   * leave the admin with no way to apply it.
   */
  async getDraftStatus(): Promise<{ pending: boolean }> {
    const [dl, dd, tdl, tdd, tcl, tcd] = await Promise.all([
      readSetting<unknown>(DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(DRAFT_DARK_KEY,  null),
      readSetting<unknown>(THEME_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DRAFT_DARK_KEY,  null),
      // The theme's staged STYLESHEET counts too, and it is not optional politeness:
      // `publishDraft` returns early when nothing is pending, so a package carrying
      // `styles/custom-*.css` and no `tokens.json` would stage a stylesheet that could
      // never be published — staged forever, invisible, with no way to apply it.
      readSetting<string | null>(THEME_CSS_DRAFT_LIGHT_KEY, null),
      readSetting<string | null>(THEME_CSS_DRAFT_DARK_KEY,  null),
    ]);
    if (dl === null && dd === null && tdl === null && tdd === null
      && tcl === null && tcd === null) return { pending: false };

    const [live, themeLive] = await Promise.all([this.getTokenOverrides(), this.getThemeTokens()]);
    if (dl !== null || dd !== null) {
      const draft = { light: normalizeScoped(dl), dark: normalizeScoped(dd) };
      if (JSON.stringify(draft) !== JSON.stringify(live)) return { pending: true };
    }
    if (tdl !== null || tdd !== null) {
      const themeDraft = { light: normalizeScoped(tdl), dark: normalizeScoped(tdd) };
      if (JSON.stringify(themeDraft) !== JSON.stringify(themeLive)) return { pending: true };
    }
    if (tcl !== null || tcd !== null) {
      const themeCssLive = await this.getThemeCustomCss();
      if ((tcl ?? "") !== themeCssLive.light || (tcd ?? "") !== themeCssLive.dark) {
        return { pending: true };
      }
    }
    return { pending: false };
  },

  // Promote the draft to live: writes the live tokens (+ history + version bump →
  // SSE push to every client), then clears the draft so it mirrors live again.
  // Returns false when there was nothing pending to publish.
  // savedById defaults to the admin who last edited the draft — used by the
  // scheduled (SYSTEM-triggered) appearance-publish job.
  async publishDraft(savedById?: string, label?: string): Promise<boolean> {
    const { pending } = await this.getDraftStatus();
    if (!pending) return false;

    // Publishing is the decision the undo point existed to defer. Once the staged
    // theme is live, the rollback covers only the staged scopes, so applying it would
    // restore the old drafts and leave the new theme published — a state neither
    // theme ever had. Dropped here rather than left to expire.
    await this.clearThemeRollback();

    let author = savedById ?? (await readSetting<string | null>(DRAFT_BY_KEY, null)) ?? undefined;
    if (author) {
      const exists = await prisma.user.findUnique({ where: { id: author }, select: { id: true } });
      if (!exists) author = undefined;
    }
    if (!author) {
      // Fall back to any administrator so the history entry has a valid author.
      const admin = await prisma.user.findFirst({
        where: { groups: { some: { group: { key: "admin" } } } },
        select: { id: true },
      });
      author = admin?.id;
    }
    if (!author) return false; // no valid author to attribute — refuse rather than FK-crash

    /**
     * The theme layer is promoted FIRST and separately: it is not the admin's work, so it
     * does not belong in the style-history snapshot, which exists so an admin can get
     * their own edits back. Restoring a snapshot restores overrides and the theme layer
     * keeps sitting underneath — exactly the inheritance behaviour wanted.
     *
     * Only when something is actually staged. Promoting unconditionally wrote two empty
     * `{}` settings on every publish of a site that has no theme at all — rows that mean
     * nothing and invite a reader to think a theme is installed.
     */
    const [stagedLight, stagedDark] = await Promise.all([
      readSetting<unknown>(THEME_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DRAFT_DARK_KEY,  null),
    ]);
    if (stagedLight !== null || stagedDark !== null) {
      const themeDraft = await this.getThemeDraftTokens();
      await prisma.$transaction([
        prisma.setting.upsert({
          where:  { key: THEME_LIGHT_KEY },
          update: { value: themeDraft.light as unknown as object },
          create: { key: THEME_LIGHT_KEY, value: themeDraft.light as unknown as object },
        }),
        prisma.setting.upsert({
          where:  { key: THEME_DARK_KEY },
          update: { value: themeDraft.dark as unknown as object },
          create: { key: THEME_DARK_KEY, value: themeDraft.dark as unknown as object },
        }),
      ]);
    }

    /**
     * The theme's stylesheet is promoted on its OWN staged-ness, not the tokens'.
     *
     * A package may carry `styles/custom-*.css` and no `tokens.json`, or the reverse.
     * Gating this on the token check above would silently strand one half of such a
     * theme in the draft forever.
     */
    const [stagedCssLight, stagedCssDark] = await Promise.all([
      readSetting<string | null>(THEME_CSS_DRAFT_LIGHT_KEY, null),
      readSetting<string | null>(THEME_CSS_DRAFT_DARK_KEY,  null),
    ]);
    const themeCssStaged = stagedCssLight !== null || stagedCssDark !== null;
    if (themeCssStaged) {
      await prisma.$transaction([
        prisma.setting.upsert({
          where:  { key: THEME_CSS_LIGHT_KEY },
          update: { value: stagedCssLight ?? "" },
          create: { key: THEME_CSS_LIGHT_KEY, value: stagedCssLight ?? "" },
        }),
        prisma.setting.upsert({
          where:  { key: THEME_CSS_DARK_KEY },
          update: { value: stagedCssDark ?? "" },
          create: { key: THEME_CSS_DARK_KEY, value: stagedCssDark ?? "" },
        }),
      ]);
      bustSettingsCache(THEME_CSS_LIGHT_KEY);
      bustSettingsCache(THEME_CSS_DARK_KEY);
    }

    const draft = await this.getDraftTokens();
    await this.saveTokens(draft, author, label ?? "Published appearance changes");
    await prisma.setting.deleteMany({
      where: { key: { in: [
        DRAFT_LIGHT_KEY, DRAFT_DARK_KEY, DRAFT_BY_KEY,
        THEME_DRAFT_LIGHT_KEY, THEME_DRAFT_DARK_KEY,
        THEME_CSS_DRAFT_LIGHT_KEY, THEME_CSS_DRAFT_DARK_KEY,
      ] } },
    });
    // The served blob is a cache of both layers, so promoting the theme's half has to
    // rebuild it. `saveTokens` already bumped the style version, and this runs before
    // the request returns, so no client can observe the stale pair.
    if (themeCssStaged) await this.recompileCustomCss();
    return true;
  },

  // ── Theme layer ───────────────────────────────────────────────────────────

  /** What the installed theme defines, LIVE. Empty when no theme has been published. */
  async getThemeTokens(): Promise<ScopedTokenSet> {
    const [light, dark] = await Promise.all([
      readSetting<unknown>(THEME_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DARK_KEY,  null),
    ]);
    return { light: normalizeScoped(light), dark: normalizeScoped(dark) };
  },

  /** The staged theme layer, falling back to the live one when no import is pending. */
  async getThemeDraftTokens(): Promise<ScopedTokenSet> {
    const [light, dark] = await Promise.all([
      readSetting<unknown>(THEME_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DRAFT_DARK_KEY,  null),
    ]);
    if (light === null && dark === null) return this.getThemeTokens();
    return { light: normalizeScoped(light), dark: normalizeScoped(dark) };
  },

  /**
   * Stage a theme's tokens. Called by a `.nvtheme` import and by nothing else.
   *
   * Two properties, both deliberate. It writes the THEME layer, never the admin's — that
   * separation is what makes an update non-destructive, per token. And it writes the
   * layer's DRAFT, so an import changes nothing visitors see until publish, which is the
   * same promise the layouts half of an import already makes.
   */
  /**
   * Put a theme's tokens on — LIVE, and mirrored into the draft.
   *
   * ⚠ It used to write the draft ONLY, which made activating a theme a two-step
   * action: stage it here, then find Publish. Worse, going fully live took publishes
   * in TWO different pages, because the layouts staged separately. Activating a theme
   * is one atomic decision, not a set of edits being batched — draft→publish is an
   * EDITING affordance and it was doing the wrong job here.
   *
   * The draft is written too, and that mirror is load-bearing: an admin with pending
   * Style Editor edits previews `theme.draft ⊕ admin.draft`, so leaving the draft on
   * the OLD theme would preview their staged edits against a theme that is no longer
   * on the site.
   */
  async saveThemeTokens(tokens: ScopedTokenSet): Promise<void> {
    const put = (key: string, value: unknown) => prisma.setting.upsert({
      where:  { key },
      update: { value: value as object },
      create: { key, value: value as object },
    });

    await prisma.$transaction([
      put(THEME_LIGHT_KEY, tokens.light),
      put(THEME_DARK_KEY,  tokens.dark),
      put(THEME_DRAFT_LIGHT_KEY, tokens.light),
      put(THEME_DRAFT_DARK_KEY,  tokens.dark),
    ]);
    for (const key of [THEME_LIGHT_KEY, THEME_DARK_KEY, THEME_DRAFT_LIGHT_KEY, THEME_DRAFT_DARK_KEY]) {
      bustSettingsCache(key);
    }
  },

  /**
   * Everything an import is about to overwrite in the appearance layers.
   *
   * Both halves of each pair — LIVE and STAGED. An import writes the staged ones, but
   * a discard that restored only those would leave the live theme layer holding a theme
   * the admin decided against, which is exactly the state they were trying to leave.
   */
  async snapshotThemeLayers(): Promise<ThemeLayerSnapshot> {
    const [tokLight, tokDark, tokDraftLight, tokDraftDark,
           cssLight, cssDark, cssDraftLight, cssDraftDark, installed] = await Promise.all([
      readSetting<unknown>(THEME_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DARK_KEY, null),
      readSetting<unknown>(THEME_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DRAFT_DARK_KEY, null),
      readSetting<unknown>(THEME_CSS_LIGHT_KEY, null),
      readSetting<unknown>(THEME_CSS_DARK_KEY, null),
      readSetting<unknown>(THEME_CSS_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_CSS_DRAFT_DARK_KEY, null),
      readSetting<Record<string, unknown> | null>(THEME_INSTALLED_KEY, null),
    ]);
    return {
      [THEME_LIGHT_KEY]: tokLight, [THEME_DARK_KEY]: tokDark,
      [THEME_DRAFT_LIGHT_KEY]: tokDraftLight, [THEME_DRAFT_DARK_KEY]: tokDraftDark,
      [THEME_CSS_LIGHT_KEY]: cssLight, [THEME_CSS_DARK_KEY]: cssDark,
      [THEME_CSS_DRAFT_LIGHT_KEY]: cssDraftLight, [THEME_CSS_DRAFT_DARK_KEY]: cssDraftDark,
      [THEME_INSTALLED_KEY]: installed,
    };
  },

  /**
   * Put the theme layers back exactly as the snapshot found them.
   *
   * ⚠ A key that was ABSENT is deleted, not written as null. `readSetting` treats a
   * missing row and a null value the same on the way out, but they are not the same
   * on the way in: `getThemeDraftCustomCss` falls back to the LIVE stylesheet only
   * when both draft keys are absent, so writing nulls would pin an empty draft
   * forever and silently blank a theme that is still installed.
   */
  async restoreThemeLayers(snapshot: ThemeLayerSnapshot): Promise<void> {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === null || value === undefined) {
        await prisma.setting.deleteMany({ where: { key } });
      } else {
        await prisma.setting.upsert({
          where:  { key },
          update: { value: value as object },
          create: { key, value: value as object },
        });
      }
      bustSettingsCache(key);
    }
    // The served blob is a cached setting on a public hot path — every writer of
    // either layer has to come back through here.
    await this.recompileCustomCss();
    await this.bumpStyleVersion();
  },

  /**
   * Record what the site looked like immediately before a theme import.
   *
   * One row, one level, overwritten by the next import. Small enough for a setting:
   * layout documents are tens of KB in total, and this is the same store the theme
   * layers themselves live in, so a rollback can never end up in a different
   * transaction from the thing it is rolling back.
   */
  async saveThemeRollback(value: ThemeRollback): Promise<void> {
    await prisma.setting.upsert({
      where:  { key: THEME_ROLLBACK_KEY },
      update: { value: value as unknown as object },
      create: { key: THEME_ROLLBACK_KEY, value: value as unknown as object },
    });
    bustSettingsCache(THEME_ROLLBACK_KEY);
  },

  async getThemeRollback(): Promise<ThemeRollback | null> {
    return readSetting<ThemeRollback | null>(THEME_ROLLBACK_KEY, null);
  },

  /**
   * Drop the undo point.
   *
   * Called on PUBLISH as well as on use. Once the staged theme is live, "undo the
   * import" no longer describes anything safe: the rollback only ever covered the
   * staged scopes, so applying it after a publish would restore the old drafts while
   * leaving the new theme published — a state neither theme ever had.
   */
  async clearThemeRollback(): Promise<void> {
    await prisma.setting.deleteMany({ where: { key: THEME_ROLLBACK_KEY } });
    bustSettingsCache(THEME_ROLLBACK_KEY);
  },

  async getInstalledTheme(): Promise<Record<string, unknown> | null> {
    return readSetting<Record<string, unknown> | null>(THEME_INSTALLED_KEY, null);
  },

  async setInstalledTheme(manifest: Record<string, unknown>): Promise<void> {
    const value = { ...manifest, importedAt: new Date().toISOString() };
    await prisma.setting.upsert({
      where:  { key: THEME_INSTALLED_KEY },
      update: { value: value as object },
      create: { key: THEME_INSTALLED_KEY, value: value as object },
    });
    bustSettingsCache(THEME_INSTALLED_KEY);
  },

  /**
   * The tokens that actually reach the page: the theme layer with the admin's on top.
   *
   * Merged per SCOPE and per TOKEN, so an admin who recoloured one accent keeps the rest
   * of the theme. Sparse on both sides — an absent token inherits from `tokens.scss` as
   * it always did.
   */
  async getEffectiveTokens(): Promise<ScopedTokenSet> {
    const [theme, admin] = await Promise.all([this.getThemeTokens(), this.getTokenOverrides()]);
    return mergeLayers(theme, admin);
  },

  /** Same, for the staged draft — what the Style Editor's preview renders. Both layers
   *  are the staged ones, so an imported theme is previewed under the admin's edits. */
  async getEffectiveDraftTokens(): Promise<ScopedTokenSet> {
    const [theme, admin] = await Promise.all([this.getThemeDraftTokens(), this.getDraftTokens()]);
    return mergeLayers(theme, admin);
  },

  // Served stylesheet: ONLY admin-saved overrides (no default fallback), normalised
  // to the scope-keyed shape. When an admin resets, these are deleted and the app
  // inherits tokens.scss directly — the true "core design".
  async getTokenOverrides(): Promise<ScopedTokenSet> {
    const [light, dark] = await Promise.all([
      readSetting<unknown>("appearance.tokens.light", null),
      readSetting<unknown>("appearance.tokens.dark",  null),
    ]);
    return { light: normalizeScoped(light), dark: normalizeScoped(dark) };
  },

  // Wipe the ADMIN's appearance overrides. With no theme installed the app falls back to
  // the bundled core (tokens.scss + index.scss); with one installed it falls back to the
  // THEME, which is the point of the separate layer — "reset" drops my edits, it does not
  // uninstall someone else's work. Bumps the version so all clients re-pull.
  async resetAppearance(): Promise<void> {
    await prisma.setting.deleteMany({
      where: { key: { in: [
        // NOT the theme layer (live or staged): "reset" drops MY edits, it does not
        // uninstall the theme underneath them.
        "appearance.tokens.light", "appearance.tokens.dark",
        DRAFT_LIGHT_KEY, DRAFT_DARK_KEY, DRAFT_BY_KEY,
        "appearance.font.family",  "appearance.font.weight", "appearance.font.size",
        // NOT the theme's stylesheet (live or staged), for the same reason the token
        // layer survives: reset drops MY edits, it does not uninstall the theme.
        "appearance.custom_css_light", "appearance.custom_css_dark", "appearance.custom_css",
        CUSTOM_CSS_COMPILED_KEY,
      ] } },
    });
    // Deleting the compiled cache is not enough: the next reader would rebuild it from
    // both layers anyway, but doing it here means the theme's stylesheet is provably
    // still being served the moment reset returns.
    await this.recompileCustomCss();
    await this.bumpStyleVersion();
  },

  async saveTokens(tokens: ScopedTokenSet, savedById: string, label?: string): Promise<void> {
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: "appearance.tokens.light" },
        update: { value: tokens.light as unknown as object },
        create: { key: "appearance.tokens.light", value: tokens.light as unknown as object },
      }),
      prisma.setting.upsert({
        where:  { key: "appearance.tokens.dark" },
        update: { value: tokens.dark as unknown as object },
        create: { key: "appearance.tokens.dark", value: tokens.dark as unknown as object },
      }),
      prisma.styleHistory.create({
        data: {
          label:   label ?? new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          tokens:  tokens as unknown as object,
          savedBy: { connect: { id: savedById } },
        },
      }),
    ]);

    const oldest = await prisma.styleHistory.findMany({
      orderBy: { createdAt: "desc" },
      skip:    20,
      select:  { id: true },
    });
    if (oldest.length > 0) {
      await prisma.styleHistory.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
    }

    // Signal every open client to pull the new CSS within one poll interval.
    await this.bumpStyleVersion();
  },

  async restoreHistory(historyId: string, savedById: string): Promise<ScopedTokenSet> {
    const entry = await prisma.styleHistory.findUniqueOrThrow({ where: { id: historyId } });
    // History entries may predate scoped storage (flat TokenSet) — normalise each
    // theme so an old snapshot restores as its `global` bucket.
    const raw    = entry.tokens as { light?: unknown; dark?: unknown };
    const tokens: ScopedTokenSet = { light: normalizeScoped(raw.light), dark: normalizeScoped(raw.dark) };
    await this.saveTokens(tokens, savedById, `Restored: ${entry.label}`);
    return tokens;
  },

  /**
   * `opts.draft` builds the stylesheet a PREVIEW should see rather than the live one.
   *
   * Tokens are already the caller's choice — they pass the draft set in. The custom
   * CSS was not: it always came from the compiled LIVE blob, so a preview of a staged
   * theme rendered that theme's colours with the PREVIOUS theme's stylesheet. Harmless
   * while the only preview was the token specimen page, and wrong the moment a whole
   * theme is being previewed on the real site.
   */
  async buildCSS(tokens: ScopedTokenSet, opts?: { draft?: boolean }): Promise<string> {
    const [family, weight, size, customCss] = await Promise.all([
      readSetting("appearance.font.family", ""),
      readSetting("appearance.font.weight", ""),
      readSetting("appearance.font.size",   ""),
      opts?.draft ? this.buildDraftCustomCss() : this.buildCustomCss(),
    ]);

    const decls = (map: TokenMap) =>
      Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n");

    // Theme prefixes: light also covers the pre-hydration default (:root).
    const prefixesFor = (theme: ThemeName) =>
      theme === "light" ? [":root", '[data-theme="light"]'] : ['[data-theme="dark"]'];

    /**
     * The same global overrides, mirrored onto the opt-in class.
     *
     * The ACP re-declares the whole palette on `body.nv-acp` so the admin panel does
     * not follow the site's theme — which also cuts off the few places in there that
     * must show what the SITE looks like (the Layout Editor's variant probe measures
     * exactly that). `.nv-site-tokens` is how such a surface asks for the site's
     * palette back, and it only means that if these overrides reach it too: the
     * bundled defaults alone would show the site as it was before anyone themed it.
     */
    const siteMirrorFor = (theme: ThemeName) =>
      theme === "light" ? [".nv-site-tokens"] : ['[data-theme="dark"] .nv-site-tokens'];

    // global → the theme root; a region scope → that region's selector under the
    // theme root, so a re-scoped component token only cascades inside the region.
    // Returns null for a scope this build does not know, and the caller SKIPS it.
    // Returning the theme root instead — which this did — silently promoted an
    // unrecognised bucket to a global override: a `.nvtheme` naming a scope from a
    // newer build would have recoloured the whole site.
    const selectorFor = (theme: ThemeName, scope: string): string | null => {
      const prefixes = prefixesFor(theme);
      // Only the global bucket is mirrored: a region scope names a selector that
      // exists on the site (`.pub-nav`, `.app-main`), and a variant scope is emitted
      // under `:root`, so it already reaches a probe anywhere in the document.
      const root = [...prefixes, ...siteMirrorFor(theme)].join(", ");
      if (scope === "global") return root;
      const desc = SCOPE_SELECTOR[scope as ThemeScope];
      if (!desc) return null;
      if (desc === ":root") return root;
      const parts = desc.split(",").map((s) => s.trim()).filter(Boolean);
      return prefixes.flatMap((p) => parts.map((d) => `${p} ${d}`)).join(", ");
    };

    // Shared with the Style Editor's live preview (@xentium/contracts) so the preview
    // cannot render a different font from the one this serves. The ACP re-pins all
    // four properties on `body.nv-acp`; a user's profile font overrides via inline
    // :root vars.
    const fontExtras = fontRootDecls({ family, weight, size });

    const parts: string[] = [];
    // Emit a block only when it has content — otherwise the app inherits the bundled
    // core tokens. global first (so region scopes can override), light before dark.
    for (const theme of ["light", "dark"] as ThemeName[]) {
      const buckets = tokens[theme];
      const scopes  = ["global", ...Object.keys(buckets).filter((s) => s !== "global")];
      for (const scope of scopes) {
        let body = buckets[scope] ? decls(buckets[scope]!) : "";
        // Font overrides ride on the light/global block (on :root → both themes).
        if (theme === "light" && scope === "global" && fontExtras.length) {
          body = [body, fontExtras.join("\n")].filter(Boolean).join("\n");
        }
        const selector = selectorFor(theme, scope);
        if (selector && body.trim()) parts.push(`${selector} {\n${body}\n}`);
      }
    }

    const bodyRule = fontBodyRule({ family, weight, size });
    if (bodyRule) parts.push(bodyRule);

    // Admin custom CSS last — highest precedence, can override anything above.
    if (typeof customCss === "string" && customCss.trim()) {
      parts.push(`/* ── custom css ── */\n${customCss.trim()}`);
    }

    return parts.join("\n\n");
  },
};
