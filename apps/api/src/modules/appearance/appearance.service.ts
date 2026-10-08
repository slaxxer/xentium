import { prisma } from "../../infrastructure/db.js";
import postcss from "postcss";
import { HEARTH_DEFAULT_TOKENS, XEC, SCOPE_SELECTOR, fontRootDecls, fontBodyRule, colourwaySchema, type Colourway, type TokenMap, type TokenSet, type ThemeScope, type ScopedTokens, type ScopedTokenSet } from "@xentium/contracts";
import { XentiumError } from "../../shared/errors/XentiumError.js";
// Appearance reads bypass the settings TTL cache on purpose: a client refetching
// /css right after a cross-process style publish must never get stale tokens.
import { bustSettingsCache, getFreshSetting as readSetting } from "../../shared/utils/settings.js";
import { publishStyleVersion } from "./appearance.sse.js";
import {
  ACTIVE_THEME_SETTING, CORE_PARAM, CORE_THEME, activeThemeKey, bustThemeBaseline, themeBaseline, themed,
  type ThemeKey,
} from "../themes/themeKey.js";

/**
 * @deprecated There is one look. Kept only so `scopeCss` keeps its published
 * signature for callers outside this module; the value is ignored.
 */
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
  const out: ScopedTokenSet = {};
  const scopes = new Set([...Object.keys(base), ...Object.keys(over)]);
  for (const scope of scopes) {
    const merged = { ...(base[scope] ?? {}), ...(over[scope] ?? {}) };
    if (Object.keys(merged).length > 0) out[scope] = merged;
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
// One root, because there is one look. This used to be a pair keyed by scheme —
// `:root:not([data-theme="dark"])` and `:root[data-theme="dark"]` — which existed
// so an admin's stylesheet could say different things depending on what the
// visitor's OS had asked for. Nothing asks any more.
const SITE_SCOPE = ":root";

// Prefix every top-level (and @media/@supports/@layer-nested) style-rule selector
// with the theme scope. @keyframes step rules, @font-face and nested rules are left
// untouched so animations/fonts still work. Invalid CSS is dropped (returns "")
// rather than corrupting the whole served stylesheet.
//
// ⚠ The site's CSS stops at the admin panel. Custom CSS is the SITE's design, and
// the ACP is not part of it — an `a { color }` or a `body { background }` written
// for the site was landing on the admin panel too, the same complaint the palette
// pin answers (`body.xt-acp`, apps/web/src/styles/_tokenDefaults.scss). So every
// rule is anchored under `body:not(.xt-acp)`: the ACP puts that class on <body>
// while it is mounted and takes it off on the way out.
//
// ⚠ `:root` / `html` rules are the exception and stay document-wide, because a rule
// on the root element cannot be qualified by a class on its child without `:has()`,
// and an unsupported selector would silently drop the admin's ENTIRE stylesheet
// rather than one rule. In practice those rules declare TOKENS, which the ACP
// re-declares over anyway — what remains is html-level paint.
const SITE_BODY = "body:not(.xt-acp)";

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

function scopeCustomCss(css: string): string {
  if (!css.trim()) return "";
  const prefix = SITE_SCOPE;
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
function assertParsableCss(css: string): void {
  if (!css.trim()) return;
  try {
    postcss.parse(css, PARSE_OPTS);
  } catch (err) {
    throw new XentiumError({
      code: XEC.API_VALIDATION,
      httpStatus: 400,
      message: `Custom CSS has a syntax error: ${err instanceof Error ? err.message : "invalid CSS"}`,
    });
  }
}

// ── Per-theme storage ────────────────────────────────────────────────────────
// Every theme — each installed one and the built-in Core theme — carries its OWN
// appearance: token overrides (live + draft), custom CSS, fonts. A key is suffixed
// `@<themeId>`; Core keeps the historical unsuffixed keys, so a site that never
// installed a theme reads exactly what it always stored.
//
// Under each theme's own edits sits what the theme SHIPPED (`themeBaseline`), read
// from its library row. Core ships nothing: its baseline is `tokens.scss` itself.
//
// Switching the site's theme changes which key is live. Nothing is copied or merged
// between themes, so going back to one restores exactly the edits made to it.

const TOKENS_KEY = "appearance.tokens";
const DRAFT_KEY = "appearance.tokens.draft";
const DRAFT_BY_KEY = "appearance.tokens.draft.by"; // user id who last edited the draft
const ADMIN_CSS_KEY = "appearance.custom_css_light";
// The served blob, compiled at save time so `/css` never runs postcss per request.
const CUSTOM_CSS_COMPILED_KEY = "appearance.custom_css_compiled";
export const FONT_KEYS = {
  family: "appearance.font.family",
  weight: "appearance.font.weight",
  size:   "appearance.font.size",
} as const;

// ⚠ Pre-collapse names (the light/dark era). Read as a fallback for CORE only — they
// predate per-theme storage, which is why no other theme can have them — and retired
// on the next write, or a stale light half would outlive the value that replaced it.
const LEGACY_TOKENS_KEY = "appearance.tokens.light";
const LEGACY_DRAFT_KEY = "appearance.tokens.draft.light";
const LEGACY_CSS_KEY = "appearance.custom_css"; // the pre-theme single blob

/** One level of undo for the last theme switch or update — see `ThemeRollback`. */
const THEME_ROLLBACK_KEY = "appearance.theme.rollback";

/**
 * The served custom-CSS blob: the THEME's stylesheet first, the admin's after it.
 *
 * Order is the inheritance. Both are scoped to the same root, so on rules of equal
 * specificity source order decides — the admin's own CSS wins exactly the way their
 * tokens do, and a theme update can never take a customisation away.
 */
function compileCustomCss(admin: string, theme: string): string {
  return [scopeCustomCss(theme), scopeCustomCss(admin)]
    .filter(Boolean)
    .join("\n\n");
}

// Editable semantic token defaults — single shared copy in @xentium/contracts,
// also consumed by the web Style Editor. tokens.scss stays the rendering truth.
export const DEFAULT_TOKENS = HEARTH_DEFAULT_TOKENS;

export type { TokenMap, TokenSet };

/**
 * One level of undo for the last theme change.
 *
 * Switching is just a change of which theme is live, so undoing it is switching back.
 * An UPDATE of a theme (a new version over an installed one) also rewrote that theme's
 * package and its untouched layouts, so it carries what it replaced.
 */
export interface ThemeRollback {
  /** The theme that was live before. `''` = Core. */
  previous: ThemeKey;
  /** Its name, for the ACP's undo button. */
  replaced: string | null;
  at:       string;
  /**
   * A colourway was made live: one theme's own colours before it, live and draft, so
   * undo puts them back. `draft` null = there was no draft.
   */
  tokens?: { key: ThemeKey; live: ScopedTokenSet; draft: ScopedTokenSet | null };
  update?: {
    themeId: string;
    /** The library row's payload and manifest before the update. */
    payload:  unknown;
    manifest: unknown;
    /** That theme's layout rows before the update. Type-only import: no runtime cycle. */
    layouts:  import("../layouts/layout.service.js").LayoutRowSnapshot[];
  };
}

// Live-sync defaults. The interval is how often each open client polls the
// version endpoint; clamped so a misconfigured value can't hammer the API or
// stall propagation. Default 5s → theme changes reach every client within ~5s.
const LIVE_REFRESH_DEFAULT_SECONDS = 5;
const LIVE_REFRESH_MIN_SECONDS     = 2;
const LIVE_REFRESH_MAX_SECONDS     = 60;

/**
 * Built stylesheet per theme (and per colourway a visitor picked of it), memoised on
 * the style version: every change that affects any theme's output bumps the version,
 * so one cheap read invalidates all.
 */
const cssMemo = new Map<string, { version: number; css: string }>();
const memoKey = (key: ThemeKey, colourway: string | null) => (colourway ? `${key}#${colourway}` : key);

/** Forget built stylesheets — on install/uninstall, when a payload changes. */
export function bustThemeCss(themeId?: string): void {
  if (themeId !== undefined) {
    for (const k of [...cssMemo.keys()]) {
      if (k === themeId || k.startsWith(`${themeId}#`)) cssMemo.delete(k);
    }
  } else cssMemo.clear();
  bustThemeBaseline(themeId || undefined);
}

/** A colourway id as a visitor's cookie or query string carries it; anything else is ignored. */
export function parseColourwayId(raw: unknown): string | null {
  const id = colourwaySchema.shape.id.safeParse(raw);
  return id.success ? id.data : null;
}

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

  /** The stylesheet visitors get: the ACTIVE theme's, published. */
  async getLiveCss(colourway: string | null = null): Promise<string> {
    return this.getCssFor(await activeThemeKey(), colourway);
  },

  /**
   * One theme's published stylesheet — its package under the admin's edits to it.
   *
   * `colourway` is a VISITOR's pick of the colourways the theme ships: its tokens go
   * over the global scope, on top of the admin's edits, because choosing an accent is
   * the one thing the reader asked for. An id the theme does not ship is ignored — the
   * cookie outlives a theme update that renamed or dropped it.
   */
  async getCssFor(key: ThemeKey, colourway: string | null = null): Promise<string> {
    const cw = colourway ? (await this.getColourways(key)).find((c) => c.id === colourway) ?? null : null;
    const memo = memoKey(key, cw?.id ?? null);
    const version = await this.getStyleVersion();
    const hit = cssMemo.get(memo);
    if (hit && hit.version === version) return hit.css;
    const tokens = await this.getEffectiveTokens(key);
    const worn = cw ? { ...tokens, global: { ...tokens.global, ...cw.tokens } } : tokens;
    const css = await this.buildCSS(worn, { key });
    cssMemo.set(memo, { version, css });
    return css;
  },

  /**
   * The colourways a theme ships, from its manifest. Core ships none.
   *
   * Each entry is checked on its own: one malformed colourway in a package costs that
   * colourway, not the theme's others.
   */
  async getColourways(key: ThemeKey): Promise<Colourway[]> {
    if (!key) return [];
    const row = await prisma.theme.findUnique({ where: { id: key }, select: { manifest: true } });
    const raw = (row?.manifest as { colourways?: unknown } | null)?.colourways;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((c) => {
      const parsed = colourwaySchema.safeParse(c);
      return parsed.success ? [parsed.data] : [];
    });
  },

  /**
   * The stylesheet for a VISITOR wearing an installed theme other than the site's.
   *
   * That theme as the admin has made it — its package under the edits made to IT, not
   * the active theme's edits, which were made for a different theme's surfaces.
   * Returns null for an id naming nothing installed, so the caller falls back to the
   * live sheet: a cookie outlives an uninstall.
   */
  async getThemeCss(themeId: string, colourway: string | null = null): Promise<string | null> {
    if (themeId === CORE_PARAM) return this.getCssFor(CORE_THEME, colourway);
    const row = await prisma.theme.findUnique({ where: { id: themeId }, select: { id: true } });
    return row ? this.getCssFor(themeId, colourway) : null;
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
  // override anything. Served as text/css (never injected as HTML).

  /** The admin's own stylesheet for one theme. */
  async getCustomCss(key: ThemeKey): Promise<string> {
    const own = await readSetting<string | null>(themed(ADMIN_CSS_KEY, key), null);
    // null = never written; "" = explicitly cleared, which must stick.
    if (own !== null || key) return own ?? "";
    return readSetting<string>(LEGACY_CSS_KEY, "");
  },

  async saveCustomCss(css: string, key: ThemeKey): Promise<void> {
    assertParsableCss(css);
    await prisma.setting.upsert({
      where:  { key: themed(ADMIN_CSS_KEY, key) },
      update: { value: css },
      create: { key: themed(ADMIN_CSS_KEY, key), value: css },
    });
    bustSettingsCache(themed(ADMIN_CSS_KEY, key));
    await this.recompileCustomCss(key);
    await this.bumpStyleVersion();
  },

  /** What the theme's own package ships as its stylesheet. Core ships none. */
  async getThemeCustomCss(key: ThemeKey): Promise<string> {
    return (await themeBaseline(key)).customCss;
  },

  /** Both layers for one theme, scoped and ready to append to the stylesheet. */
  async buildCustomCss(key: ThemeKey): Promise<string> {
    const compiled = await readSetting<string | null>(themed(CUSTOM_CSS_COMPILED_KEY, key), null);
    if (compiled !== null) return compiled;
    return this.recompileCustomCss(key);
  },

  /**
   * Rebuild and cache one theme's served blob from both of its layers. Every writer of
   * either layer — the console, an install or update of the theme — comes through here.
   */
  async recompileCustomCss(key: ThemeKey): Promise<string> {
    const [admin, theme] = await Promise.all([this.getCustomCss(key), this.getThemeCustomCss(key)]);
    const result = compileCustomCss(admin, theme);
    const k = themed(CUSTOM_CSS_COMPILED_KEY, key);
    await prisma.setting.upsert({ where: { key: k }, update: { value: result }, create: { key: k, value: result } });
    bustSettingsCache(k);
    return result;
  },

  /** Scope a single raw blob — used by the live-preview endpoint. */
  scopeCss(css: string, _theme?: ThemeName): string {
    return scopeCustomCss(css);
  },

  // ── Fonts ─────────────────────────────────────────────────────────────────

  async getFont(key: ThemeKey): Promise<{ family: string; weight: string; size: string }> {
    const [family, weight, size] = await Promise.all([
      readSetting<string>(themed(FONT_KEYS.family, key), ""),
      readSetting<string>(themed(FONT_KEYS.weight, key), ""),
      readSetting<string>(themed(FONT_KEYS.size, key), ""),
    ]);
    return { family: String(family ?? ""), weight: String(weight ?? ""), size: String(size ?? "") };
  },

  /** Live on save, as the font settings always were. */
  async saveFont(font: Partial<{ family: string; weight: string; size: string }>, key: ThemeKey): Promise<void> {
    for (const [field, value] of Object.entries(font) as [keyof typeof FONT_KEYS, string | undefined][]) {
      if (value === undefined) continue;
      const k = themed(FONT_KEYS[field], key);
      await prisma.setting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
      bustSettingsCache(k);
    }
    await this.bumpStyleVersion();
  },

  // ── Tokens ────────────────────────────────────────────────────────────────
  // The admin's overrides are SPARSE and scope-keyed (ADR-0003): a token present in
  // a bucket is an explicit override, an absent one inherits. The Style Editor edits
  // the DRAFT, which falls back to live when no draft has been started.

  async getTokens(key: ThemeKey): Promise<ScopedTokenSet> {
    return this.getDraftTokens(key);
  },

  /** A value that may have a Core-only pre-collapse fallback. `null` = nothing stored. */
  async readOwn<T = unknown>(base: string, legacy: string, key: ThemeKey): Promise<T | null> {
    const own = await readSetting<T | null>(themed(base, key), null);
    if (own !== null || key) return own;
    return readSetting<T | null>(legacy, null);
  },

  async getDraftTokens(key: ThemeKey): Promise<ScopedTokenSet> {
    const staged = await this.readOwn(DRAFT_KEY, LEGACY_DRAFT_KEY, key);
    if (staged === null) return this.getTokenOverrides(key); // no draft → live
    return normalizeScoped(staged);
  },

  // Save editor changes to the draft only — no version bump, no SSE push, no
  // history entry. Records the editing admin so a scheduled (SYSTEM) publish can
  // attribute the history entry.
  async saveDraftTokens(tokens: ScopedTokenSet, savedById: string, key: ThemeKey): Promise<void> {
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: themed(DRAFT_KEY, key) },
        update: { value: tokens as unknown as object },
        create: { key: themed(DRAFT_KEY, key), value: tokens as unknown as object },
      }),
      prisma.setting.upsert({
        where:  { key: themed(DRAFT_BY_KEY, key) },
        update: { value: savedById },
        create: { key: themed(DRAFT_BY_KEY, key), value: savedById },
      }),
    ]);
  },

  /**
   * Merge ONE scope's overrides into the draft.
   *
   * The Layout Editor's variant panel is a second writer of the same draft, and a
   * read-modify-write of the WHOLE token set from two surfaces loses whichever edit
   * landed first. So this patches a single bucket server-side: a `null` value clears
   * that token, and a bucket left empty is deleted rather than stored as `{}`.
   */
  async saveDraftScope(
    scope: string,
    patch: Record<string, string | null>,
    savedById: string,
    key: ThemeKey,
  ): Promise<ScopedTokenSet> {
    const draft = await this.getDraftTokens(key);
    const next: ScopedTokenSet = { ...draft };

    const bucket: TokenMap = { ...(next[scope] ?? {}) };
    for (const [cssVar, value] of Object.entries(patch)) {
      if (value === null) delete bucket[cssVar];
      else bucket[cssVar] = value;
    }
    if (Object.keys(bucket).length === 0) delete next[scope];
    else next[scope] = bucket;

    await this.saveDraftTokens(next, savedById, key);
    return next;
  },

  /** Is there a draft for this theme that differs from what is live? */
  async getDraftStatus(key: ThemeKey): Promise<{ pending: boolean }> {
    const staged = await this.readOwn(DRAFT_KEY, LEGACY_DRAFT_KEY, key);
    if (staged === null) return { pending: false };
    const live = await this.getTokenOverrides(key);
    return { pending: JSON.stringify(normalizeScoped(staged)) !== JSON.stringify(live) };
  },

  // Promote one theme's draft to live: writes the live tokens (+ history + version
  // bump → SSE push), then clears the draft so it mirrors live again. Returns false
  // when there was nothing pending. savedById defaults to the admin who last edited
  // the draft — the scheduled (SYSTEM-triggered) appearance-publish job relies on it.
  async publishDraft(savedById: string | undefined, label: string | undefined, key: ThemeKey): Promise<boolean> {
    const { pending } = await this.getDraftStatus(key);
    if (!pending) return false;

    let author = savedById ?? (await readSetting<string | null>(themed(DRAFT_BY_KEY, key), null)) ?? undefined;
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

    const draft = await this.getDraftTokens(key);
    await this.saveTokens(draft, author, label ?? "Published appearance changes", key);
    const drop = [themed(DRAFT_KEY, key), themed(DRAFT_BY_KEY, key)];
    // The pre-collapse draft goes with Core's, or it would be read as a draft forever.
    if (!key) drop.push(LEGACY_DRAFT_KEY);
    await prisma.setting.deleteMany({ where: { key: { in: drop } } });
    return true;
  },

  /**
   * Change one scope of a theme's LIVE colours in one step — a colourway made live from
   * the Themes page — and the draft with it, when there is one: a draft is a full copy
   * of the colours, and publishing it later must not quietly undo this.
   *
   * Returns what was there before, for undo.
   */
  async patchLiveScope(
    scope: string,
    patch: Record<string, string | null>,
    savedById: string,
    label: string,
    key: ThemeKey,
  ): Promise<{ live: ScopedTokenSet; draft: ScopedTokenSet | null }> {
    const apply = (set: ScopedTokenSet): ScopedTokenSet => {
      const bucket: TokenMap = { ...(set[scope] ?? {}) };
      for (const [cssVar, value] of Object.entries(patch)) {
        if (value === null) delete bucket[cssVar];
        else bucket[cssVar] = value;
      }
      const next: ScopedTokenSet = { ...set };
      if (Object.keys(bucket).length === 0) delete next[scope];
      else next[scope] = bucket;
      return next;
    };
    const live = await this.getTokenOverrides(key);
    const staged = await this.readOwn(DRAFT_KEY, LEGACY_DRAFT_KEY, key);
    const draft = staged === null ? null : normalizeScoped(staged);
    await this.saveTokens(apply(live), savedById, label, key);
    if (draft) await this.saveDraftTokens(apply(draft), savedById, key);
    return { live, draft };
  },

  /** Put a theme's live colours (and its draft) back as `patchLiveScope` found them. */
  async restoreTokens(snapshot: { live: ScopedTokenSet; draft: ScopedTokenSet | null }, savedById: string, key: ThemeKey): Promise<void> {
    await this.saveTokens(snapshot.live, savedById, "Undo colourway", key);
    if (snapshot.draft) await this.saveDraftTokens(snapshot.draft, savedById, key);
    else {
      const drop = [themed(DRAFT_KEY, key), themed(DRAFT_BY_KEY, key)];
      await prisma.setting.deleteMany({ where: { key: { in: drop } } });
      for (const k of drop) bustSettingsCache(k);
    }
  },

  /** What the theme's package defines. Core ships none. */
  async getThemeTokens(key: ThemeKey): Promise<ScopedTokenSet> {
    return normalizeScoped((await themeBaseline(key)).tokens);
  },

  /**
   * The tokens that reach the page for one theme: what it ships, with the admin's
   * edits to it on top — per scope and per token, so recolouring one accent keeps the
   * rest of the theme. Sparse on both sides.
   */
  async getEffectiveTokens(key: ThemeKey): Promise<ScopedTokenSet> {
    const [theme, admin] = await Promise.all([this.getThemeTokens(key), this.getTokenOverrides(key)]);
    return mergeLayers(theme, admin);
  },

  /** Same, for the staged draft — what an editor's preview of that theme renders. */
  async getEffectiveDraftTokens(key: ThemeKey): Promise<ScopedTokenSet> {
    const [theme, admin] = await Promise.all([this.getThemeTokens(key), this.getDraftTokens(key)]);
    return mergeLayers(theme, admin);
  },

  /** The admin's LIVE overrides for one theme, exactly as saved. */
  async getTokenOverrides(key: ThemeKey): Promise<ScopedTokenSet> {
    return normalizeScoped(await this.readOwn(TOKENS_KEY, LEGACY_TOKENS_KEY, key));
  },

  /**
   * Drop the admin's edits to ONE theme: its tokens, draft, fonts and custom CSS. The
   * theme's own package stays — "reset" drops MY edits, it does not uninstall the
   * theme — and every other theme is untouched.
   */
  async resetAppearance(key: ThemeKey): Promise<void> {
    const keys = [
      TOKENS_KEY, DRAFT_KEY, DRAFT_BY_KEY, ADMIN_CSS_KEY, CUSTOM_CSS_COMPILED_KEY,
      FONT_KEYS.family, FONT_KEYS.weight, FONT_KEYS.size,
    ].map((k) => themed(k, key));
    if (!key) {
      keys.push(LEGACY_TOKENS_KEY, "appearance.tokens.dark", LEGACY_DRAFT_KEY,
        "appearance.tokens.draft.dark", "appearance.custom_css_dark", LEGACY_CSS_KEY);
    }
    await prisma.setting.deleteMany({ where: { key: { in: keys } } });
    for (const k of keys) bustSettingsCache(k);
    await this.recompileCustomCss(key);
    await this.bumpStyleVersion();
  },

  /** Everything stored for one theme's appearance, for uninstall. */
  async forgetTheme(key: ThemeKey): Promise<void> {
    if (!key) return; // Core cannot be uninstalled
    await prisma.setting.deleteMany({ where: { key: { endsWith: `@${key}` } } });
    await prisma.styleHistory.deleteMany({ where: { themeKey: key } });
    bustThemeCss(key);
  },

  async saveTokens(tokens: ScopedTokenSet, savedById: string, label: string | undefined, key: ThemeKey): Promise<void> {
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: themed(TOKENS_KEY, key) },
        update: { value: tokens as unknown as object },
        create: { key: themed(TOKENS_KEY, key), value: tokens as unknown as object },
      }),
      // Core's pre-collapse rows are a READ FALLBACK, so a save has to retire them.
      ...(key ? [] : [prisma.setting.deleteMany({
        where: { key: { in: [LEGACY_TOKENS_KEY, "appearance.tokens.dark"] } },
      })]),
      prisma.styleHistory.create({
        data: {
          themeKey: key,
          label:   label ?? new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          tokens:  tokens as unknown as object,
          savedBy: { connect: { id: savedById } },
        },
      }),
    ]);

    // Twenty per theme — one busy theme must not push another's history out.
    const oldest = await prisma.styleHistory.findMany({
      where:   { themeKey: key },
      orderBy: { createdAt: "desc" },
      skip:    20,
      select:  { id: true },
    });
    if (oldest.length > 0) {
      await prisma.styleHistory.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
    }

    // Signal every open client to pull the new CSS.
    await this.bumpStyleVersion();
  },

  /** Put a history entry back live — onto the theme it was published for. */
  async restoreHistory(historyId: string, savedById: string): Promise<ScopedTokenSet> {
    const entry = await prisma.styleHistory.findUniqueOrThrow({ where: { id: historyId } });
    // A snapshot may predate either storage change: the two-palette shape, or flat
    // (unscoped) maps before that. The light half is the one that survives.
    const raw = entry.tokens as Record<string, unknown>;
    const legacyPair = raw && typeof raw === "object" && ("light" in raw || "dark" in raw);
    const tokens = normalizeScoped(legacyPair ? raw.light : raw);
    await this.saveTokens(tokens, savedById, `Restored: ${entry.label}`, entry.themeKey);
    return tokens;
  },

  // ── The active theme ──────────────────────────────────────────────────────

  /** The live theme's manifest, or null when Core is live. */
  async getInstalledTheme(): Promise<Record<string, unknown> | null> {
    return readSetting<Record<string, unknown> | null>(ACTIVE_THEME_SETTING, null);
  },

  /** Make a theme live — `null` makes Core live. */
  async setInstalledTheme(manifest: Record<string, unknown> | null): Promise<void> {
    if (manifest === null) {
      await prisma.setting.deleteMany({ where: { key: ACTIVE_THEME_SETTING } });
    } else {
      const value = { ...manifest, importedAt: new Date().toISOString() };
      await prisma.setting.upsert({
        where:  { key: ACTIVE_THEME_SETTING },
        update: { value: value as object },
        create: { key: ACTIVE_THEME_SETTING, value: value as object },
      });
    }
    bustSettingsCache(ACTIVE_THEME_SETTING);
  },

  async saveThemeRollback(value: ThemeRollback): Promise<void> {
    await prisma.setting.upsert({
      where:  { key: THEME_ROLLBACK_KEY },
      update: { value: value as unknown as object },
      create: { key: THEME_ROLLBACK_KEY, value: value as unknown as object },
    });
    bustSettingsCache(THEME_ROLLBACK_KEY);
  },

  async getThemeRollback(): Promise<ThemeRollback | null> {
    const value = await readSetting<ThemeRollback | null>(THEME_ROLLBACK_KEY, null);
    // A rollback recorded before per-theme storage restores layers that no longer
    // exist; it is not offered.
    return value && typeof value === "object" && "previous" in value ? value : null;
  },

  async clearThemeRollback(): Promise<void> {
    await prisma.setting.deleteMany({ where: { key: THEME_ROLLBACK_KEY } });
    bustSettingsCache(THEME_ROLLBACK_KEY);
  },

  /**
   * Build one theme's stylesheet from a token set.
   *
   * `opts.key` names the theme whose fonts and custom CSS go with the tokens — the
   * caller already chose live or draft tokens; fonts and custom CSS have no draft.
   */
  async buildCSS(tokens: ScopedTokenSet, opts: { key: ThemeKey }): Promise<string> {
    const [{ family, weight, size }, customCss] = await Promise.all([
      this.getFont(opts.key),
      this.buildCustomCss(opts.key),
    ]);

    const decls = (map: TokenMap) =>
      Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n");

    /**
     * Where a global override lands: the document root, plus `.xt-site-tokens` — the
     * class through which an ACP surface asks for the SITE's palette back (the ACP
     * re-declares its own on `body.xt-acp`).
     */
    const ROOT_PREFIX  = ":root";
    const SITE_MIRROR  = ".xt-site-tokens";

    // global → the root; a region scope → that region's selector under the root.
    // Returns null for a scope this build does not know, and the caller SKIPS it —
    // a `.xttheme` naming a scope from a newer build must not recolour the whole site.
    const selectorFor = (scope: string): string | null => {
      const root = `${ROOT_PREFIX}, ${SITE_MIRROR}`;
      if (scope === "global") return root;
      const desc = SCOPE_SELECTOR[scope as ThemeScope];
      if (!desc) return null;
      if (desc === ":root") return root;
      return desc.split(",").map((d) => d.trim()).filter(Boolean)
        .map((d) => `${ROOT_PREFIX} ${d}`).join(", ");
    };

    // Shared with the Style Editor's live preview (@xentium/contracts) so the preview
    // cannot render a different font from the one this serves.
    const fontExtras = fontRootDecls({ family, weight, size });

    const parts: string[] = [];
    // global first, so region scopes can override it.
    const scopes = ["global", ...Object.keys(tokens).filter((s) => s !== "global")];
    for (const scope of scopes) {
      let body = tokens[scope] ? decls(tokens[scope]!) : "";
      if (scope === "global" && fontExtras.length) {
        body = [body, fontExtras.join("\n")].filter(Boolean).join("\n");
      }
      const selector = selectorFor(scope);
      if (selector && body.trim()) parts.push(`${selector} {\n${body}\n}`);
    }

    const bodyRule = fontBodyRule({ family, weight, size });
    if (bodyRule) parts.push(bodyRule);

    // Custom CSS last — highest precedence, can override anything above.
    if (typeof customCss === "string" && customCss.trim()) {
      parts.push(`/* ── custom css ── */\n${customCss.trim()}`);
    }

    return parts.join("\n\n");
  },
};
