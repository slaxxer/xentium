import { prisma } from "../../infrastructure/db.js";
import postcss from "postcss";
import { HEARTH_DEFAULT_TOKENS, NEC, SCOPE_SELECTOR, type TokenMap, type TokenSet, type ThemeScope, type ScopedTokens, type ScopedTokenSet } from "@nodevo/contracts";
import { NodevoError } from "../../shared/errors/NodevoError.js";
// Appearance reads bypass the settings TTL cache on purpose: a client refetching
// /css right after a cross-process style publish must never get stale tokens.
import { bustSettingsCache, getFreshSetting as readSetting } from "../../shared/utils/settings.js";
import { publishStyleVersion } from "./appearance.sse.js";

export type ThemeName = "light" | "dark";

// ScopedTokens / ScopedTokenSet now live in @nodevo/contracts (shared with the
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
// Apply the theme scope to one selector. Selectors that target the root element
// (`:root` / `html`) get the scope MERGED onto them (compound) so a custom
// `:root { --c-accent: red }` actually overrides the palette token — prefixing as
// a descendant (`scope :root`) would match nothing. Everything else is a descendant.
function scopeSelector(sel: string, prefix: string): string {
  const t = sel.trim();
  if (t === ":root" || t === "html") return prefix;
  // `:root.x` / `html.x` / `:root[x]` / `:root:hover` → keep the trailing compound
  const m = t.match(/^(?::root|html)((?:[.#:[]|::).*)$/);
  if (m) return prefix + m[1];
  return `${prefix} ${t}`;
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
    throw new NodevoError({
      code: NEC.API_VALIDATION,
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

function compileCustomCss(light: string, dark: string): string {
  return [scopeCustomCss(light, "light"), scopeCustomCss(dark, "dark")]
    .filter(Boolean)
    .join("\n\n");
}

// Editable semantic token defaults — single shared copy in @nodevo/contracts,
// also consumed by the web Style Editor. tokens.scss stays the rendering truth.
export const DEFAULT_TOKENS = HEARTH_DEFAULT_TOKENS;

export type { TokenMap, TokenSet };

const FONT_STACKS: Record<string, string> = {
  "Poppins":    "Poppins, sans-serif",
  "Nunito":     "Nunito, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Open Sans":  '"Open Sans", sans-serif',
  "Ubuntu":     "Ubuntu, sans-serif",
};

// Live-sync defaults. The interval is how often each open client polls the
// version endpoint; clamped so a misconfigured value can't hammer the API or
// stall propagation. Default 5s → theme changes reach every client within ~5s.
const LIVE_REFRESH_DEFAULT_SECONDS = 5;
const LIVE_REFRESH_MIN_SECONDS     = 2;
const LIVE_REFRESH_MAX_SECONDS     = 60;

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
    const compiled = compileCustomCss(css.light, css.dark);
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

  /** Theme-scoped custom CSS for both themes, ready to append to the stylesheet. */
  async buildCustomCss(): Promise<string> {
    const compiled = await readSetting<string | null>(CUSTOM_CSS_COMPILED_KEY, null);
    if (compiled !== null) return compiled;
    // Raw CSS saved before compile-on-save existed (or the legacy single blob):
    // compile once and persist so subsequent /css requests skip postcss entirely.
    const { light, dark } = await this.getCustomCss();
    const result = compileCustomCss(light, dark);
    await prisma.setting.upsert({
      where:  { key: CUSTOM_CSS_COMPILED_KEY },
      update: { value: result },
      create: { key: CUSTOM_CSS_COMPILED_KEY, value: result },
    });
    return result;
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
    const [dl, dd, tdl, tdd] = await Promise.all([
      readSetting<unknown>(DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(DRAFT_DARK_KEY,  null),
      readSetting<unknown>(THEME_DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(THEME_DRAFT_DARK_KEY,  null),
    ]);
    if (dl === null && dd === null && tdl === null && tdd === null) return { pending: false };

    const [live, themeLive] = await Promise.all([this.getTokenOverrides(), this.getThemeTokens()]);
    if (dl !== null || dd !== null) {
      const draft = { light: normalizeScoped(dl), dark: normalizeScoped(dd) };
      if (JSON.stringify(draft) !== JSON.stringify(live)) return { pending: true };
    }
    if (tdl !== null || tdd !== null) {
      const themeDraft = { light: normalizeScoped(tdl), dark: normalizeScoped(tdd) };
      if (JSON.stringify(themeDraft) !== JSON.stringify(themeLive)) return { pending: true };
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

    const draft = await this.getDraftTokens();
    await this.saveTokens(draft, author, label ?? "Published appearance changes");
    await prisma.setting.deleteMany({
      where: { key: { in: [
        DRAFT_LIGHT_KEY, DRAFT_DARK_KEY, DRAFT_BY_KEY,
        THEME_DRAFT_LIGHT_KEY, THEME_DRAFT_DARK_KEY,
      ] } },
    });
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
  async saveThemeTokens(tokens: ScopedTokenSet): Promise<void> {
    await prisma.$transaction([
      prisma.setting.upsert({
        where:  { key: THEME_DRAFT_LIGHT_KEY },
        update: { value: tokens.light as unknown as object },
        create: { key: THEME_DRAFT_LIGHT_KEY, value: tokens.light as unknown as object },
      }),
      prisma.setting.upsert({
        where:  { key: THEME_DRAFT_DARK_KEY },
        update: { value: tokens.dark as unknown as object },
        create: { key: THEME_DRAFT_DARK_KEY, value: tokens.dark as unknown as object },
      }),
    ]);
    bustSettingsCache(THEME_DRAFT_LIGHT_KEY);
    bustSettingsCache(THEME_DRAFT_DARK_KEY);
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
        "appearance.custom_css_light", "appearance.custom_css_dark", "appearance.custom_css",
        CUSTOM_CSS_COMPILED_KEY,
      ] } },
    });
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

  async buildCSS(tokens: ScopedTokenSet): Promise<string> {
    const [family, weight, size, customCss] = await Promise.all([
      readSetting("appearance.font.family", ""),
      readSetting("appearance.font.weight", ""),
      readSetting("appearance.font.size",   ""),
      this.buildCustomCss(),
    ]);

    const decls = (map: TokenMap) =>
      Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n");

    // Theme prefixes: light also covers the pre-hydration default (:root).
    const prefixesFor = (theme: ThemeName) =>
      theme === "light" ? [":root", '[data-theme="light"]'] : ['[data-theme="dark"]'];

    // global → the theme root; a region scope → that region's selector under the
    // theme root, so a re-scoped component token only cascades inside the region.
    // Returns null for a scope this build does not know, and the caller SKIPS it.
    // Returning the theme root instead — which this did — silently promoted an
    // unrecognised bucket to a global override: a `.nvtheme` naming a scope from a
    // newer build would have recoloured the whole site.
    const selectorFor = (theme: ThemeName, scope: string): string | null => {
      const prefixes = prefixesFor(theme);
      if (scope === "global") return prefixes.join(", ");
      const desc = SCOPE_SELECTOR[scope as ThemeScope];
      if (!desc) return null;
      if (desc === ":root") return prefixes.join(", ");
      const parts = desc.split(",").map((s) => s.trim()).filter(Boolean);
      return prefixes.flatMap((p) => parts.map((d) => `${p} ${d}`)).join(", ");
    };

    const fontExtras: string[] = [];
    // The chosen family is SITE-WIDE: body (--ff-sans) AND headings
    // (--font-display). The ACP re-pins both to Poppins client-side
    // (body.nv-acp); a user's profile font overrides via inline :root vars.
    if (family && FONT_STACKS[family]) {
      fontExtras.push(`  --ff-sans: ${FONT_STACKS[family]};`);
      fontExtras.push(`  --font-display: ${FONT_STACKS[family]};`);
    }
    if (weight) fontExtras.push(`  --fw-body: ${weight};`);
    if (size)   fontExtras.push(`  --fs-base: ${size}px;`);

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

    if (family || weight || size) {
      const bodyRules: string[] = [];
      if (family) bodyRules.push(`  font-family: var(--ff-sans);`);
      if (size)   bodyRules.push(`  font-size: var(--fs-base);`);
      if (weight) bodyRules.push(`  font-weight: var(--fw-body);`);
      parts.push(`body, input, textarea, select, button {\n${bodyRules.join("\n")}\n}`);
    }

    // Admin custom CSS last — highest precedence, can override anything above.
    if (typeof customCss === "string" && customCss.trim()) {
      parts.push(`/* ── custom css ── */\n${customCss.trim()}`);
    }

    return parts.join("\n\n");
  },
};
