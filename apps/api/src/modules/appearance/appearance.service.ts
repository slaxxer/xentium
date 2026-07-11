import { prisma } from "../../infrastructure/db.js";
import AdmZip from "adm-zip";
import postcss from "postcss";
import { HEARTH_DEFAULT_TOKENS, NEC, SCOPE_SELECTOR, type TokenMap, type TokenSet, type ThemeScope, type ScopedTokens, type ScopedTokenSet } from "@nodevo/contracts";
import { NodevoError } from "../../shared/errors/NodevoError.js";
// Appearance reads bypass the settings TTL cache on purpose: a client refetching
// /css right after a cross-process style publish must never get stale tokens.
import { getFreshSetting as readSetting } from "../../shared/utils/settings.js";
import { publishStyleVersion } from "./appearance.sse.js";

export type ThemeName = "light" | "dark";

// ScopedTokens / ScopedTokenSet now live in @nodevo/contracts (shared with the
// Style Editor). Re-exported below for existing importers of this module.
export type { ScopedTokens, ScopedTokenSet };

// Back-compat shim: legacy storage is a flat TokenMap (string values); the new
// shape is scope→map (object values). Normalise either into the scoped shape.
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

function scopeCustomCss(css: string, theme: ThemeName): string {
  if (!css.trim()) return "";
  const prefix = THEME_SCOPE[theme];
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
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
    postcss.parse(css);
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
  "Raleway":    "Raleway, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Poppins":    "Poppins, sans-serif",
  "Open Sans":  '"Open Sans", sans-serif',
  "Ubuntu":     "Ubuntu, sans-serif",
  "Roboto":     "Roboto, sans-serif",
};

// Validates that CSS only contains :root { --custom-property: value } blocks.
function validateStylePackCss(css: string): boolean {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!stripped) return true;
  // Allow only :root { ... } blocks containing only CSS custom properties
  const rootOnlyPattern = /^(:root\s*\{[^}]*\}[\s]*)+$/;
  if (!rootOnlyPattern.test(stripped)) return false;
  // Inside the block, only --variable: value; lines
  const inner = stripped.replace(/:root\s*\{/g, "").replace(/\}/g, "");
  const lines  = inner.split(";").map((l) => l.trim()).filter(Boolean);
  return lines.every((l) => /^--[\w-]+\s*:\s*.+$/.test(l));
}

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
    const css = await this.buildCSS(await this.getTokenOverrides());
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

  // Is there a draft that differs from what's currently live?
  async getDraftStatus(): Promise<{ pending: boolean }> {
    const [dl, dd] = await Promise.all([
      readSetting<unknown>(DRAFT_LIGHT_KEY, null),
      readSetting<unknown>(DRAFT_DARK_KEY,  null),
    ]);
    if (dl === null && dd === null) return { pending: false };
    const draft = { light: normalizeScoped(dl), dark: normalizeScoped(dd) };
    const live  = await this.getTokenOverrides();
    return { pending: JSON.stringify(draft) !== JSON.stringify(live) };
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

    const draft = await this.getDraftTokens();
    await this.saveTokens(draft, author, label ?? "Published appearance changes");
    await prisma.setting.deleteMany({ where: { key: { in: [DRAFT_LIGHT_KEY, DRAFT_DARK_KEY, DRAFT_BY_KEY] } } });
    return true;
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

  // Wipe every appearance override so the app falls back to the bundled core
  // (tokens.scss + index.scss). Bumps the version so all clients re-pull.
  async resetAppearance(): Promise<void> {
    await prisma.setting.deleteMany({
      where: { key: { in: [
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
    const selectorFor = (theme: ThemeName, scope: string): string => {
      const prefixes = prefixesFor(theme);
      const desc = scope === "global" ? "" : (SCOPE_SELECTOR[scope as ThemeScope] ?? "");
      if (!desc || desc === ":root") return prefixes.join(", ");
      const parts = desc.split(",").map((s) => s.trim()).filter(Boolean);
      return prefixes.flatMap((p) => parts.map((d) => `${p} ${d}`)).join(", ");
    };

    const fontExtras: string[] = [];
    if (family && FONT_STACKS[family]) fontExtras.push(`  --ff-sans: ${FONT_STACKS[family]};`);
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
        if (body.trim()) parts.push(`${selectorFor(theme, scope)} {\n${body}\n}`);
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

  // ── Style packs (.nvstyle) ─────────────────────────────────────────────────

  async installStylePack(fileBuffer: Buffer, userId: string) {
    const zip = new AdmZip(fileBuffer);

    const manifestEntry = zip.getEntry("manifest.json");
    if (!manifestEntry) throw new Error("Missing manifest.json");

    let manifest: { name?: string; vendor?: string; version?: string };
    try {
      manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
    } catch {
      throw new Error("manifest.json is not valid JSON");
    }
    if (!manifest.name) throw new Error("manifest.json missing required field: name");

    const lightEntry = zip.getEntry("styles/light.css");
    const darkEntry  = zip.getEntry("styles/dark.css");
    if (!lightEntry) throw new Error("Missing styles/light.css");
    if (!darkEntry)  throw new Error("Missing styles/dark.css");

    const lightCss = lightEntry.getData().toString("utf8");
    const darkCss  = darkEntry.getData().toString("utf8");

    if (!validateStylePackCss(lightCss)) throw new Error("styles/light.css contains non-custom-property CSS rules");
    if (!validateStylePackCss(darkCss))  throw new Error("styles/dark.css contains non-custom-property CSS rules");

    return prisma.installedStylePack.create({
      data: {
        name:        manifest.name,
        vendor:      manifest.vendor ?? "community",
        version:     manifest.version ?? "1.0.0",
        lightCss,
        darkCss,
        installedBy: userId,
      },
    });
  },

  async listStylePacks() {
    return prisma.installedStylePack.findMany({
      orderBy: { installedAt: "desc" },
      select: { id: true, name: true, vendor: true, version: true, isActive: true, installedAt: true },
    });
  },

  async activateStylePack(packId: string, userId: string) {
    const pack = await prisma.installedStylePack.findUniqueOrThrow({ where: { id: packId } });

    // Parse the light/dark CSS into token maps
    const parseTokens = (css: string): TokenMap => {
      const map: TokenMap = {};
      const matches = css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
      for (const m of matches) {
        if (m[1] && m[2]) map[m[1].trim()] = m[2].trim();
      }
      return map;
    };

    // Style packs are `:root`-only (validateStylePackCss) → their tokens are global.
    const tokens: ScopedTokenSet = {
      light: { global: parseTokens(pack.lightCss) },
      dark:  { global: parseTokens(pack.darkCss) },
    };

    await this.saveTokens(tokens, userId, `Pack: ${pack.name}`);

    await prisma.$transaction([
      prisma.installedStylePack.updateMany({ data: { isActive: false } }),
      prisma.installedStylePack.update({ where: { id: packId }, data: { isActive: true } }),
    ]);

    return tokens;
  },

  async deleteStylePack(packId: string) {
    await prisma.installedStylePack.delete({ where: { id: packId } });
  },
};
