import { prisma } from "../../infrastructure/db.js";
import AdmZip from "adm-zip";
import postcss from "postcss";
import { HEARTH_DEFAULT_TOKENS, NEC, type TokenMap, type TokenSet } from "@nodevo/contracts";
import { NodevoError } from "../../shared/errors/NodevoError.js";

export type ThemeName = "light" | "dark";

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

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value as unknown as T;
}

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

export const appearanceService = {
  // Monotonic-ish marker bumped on every change that affects the served CSS.
  // Clients poll getStyleVersion() and refetch the CSS only when it changes.
  async bumpStyleVersion(): Promise<void> {
    await prisma.setting.upsert({
      where:  { key: "appearance.style_version" },
      update: { value: Date.now() },
      create: { key: "appearance.style_version", value: Date.now() },
    });
  },

  async getStyleVersion(): Promise<number> {
    return readSetting<number>("appearance.style_version", 0);
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

  // Editor display: saved values, or the built-in defaults so the pickers have
  // something to show.
  async getTokens(): Promise<TokenSet> {
    const [light, dark] = await Promise.all([
      readSetting("appearance.tokens.light", DEFAULT_TOKENS.light as TokenMap),
      readSetting("appearance.tokens.dark",  DEFAULT_TOKENS.dark  as TokenMap),
    ]);
    return { light, dark };
  },

  // Served stylesheet: ONLY admin-saved overrides (no default fallback). When an
  // admin resets, these are deleted and the app inherits tokens.scss directly —
  // the true "core design" — instead of having a defaults snapshot painted on top.
  async getTokenOverrides(): Promise<TokenSet> {
    const [light, dark] = await Promise.all([
      readSetting<TokenMap | null>("appearance.tokens.light", null),
      readSetting<TokenMap | null>("appearance.tokens.dark",  null),
    ]);
    return { light: light ?? {}, dark: dark ?? {} };
  },

  // Wipe every appearance override so the app falls back to the bundled core
  // (tokens.scss + index.scss). Bumps the version so all clients re-pull.
  async resetAppearance(): Promise<void> {
    await prisma.setting.deleteMany({
      where: { key: { in: [
        "appearance.tokens.light", "appearance.tokens.dark",
        "appearance.font.family",  "appearance.font.weight", "appearance.font.size",
        "appearance.custom_css_light", "appearance.custom_css_dark", "appearance.custom_css",
        CUSTOM_CSS_COMPILED_KEY,
      ] } },
    });
    await this.bumpStyleVersion();
  },

  async saveTokens(tokens: TokenSet, savedById: string, label?: string): Promise<void> {
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

  async restoreHistory(historyId: string, savedById: string): Promise<TokenSet> {
    const entry  = await prisma.styleHistory.findUniqueOrThrow({ where: { id: historyId } });
    const tokens = entry.tokens as unknown as TokenSet;
    await this.saveTokens(tokens, savedById, `Restored: ${entry.label}`);
    return tokens;
  },

  async buildCSS(tokens: TokenSet): Promise<string> {
    const [family, weight, size, customCss] = await Promise.all([
      readSetting("appearance.font.family", ""),
      readSetting("appearance.font.weight", ""),
      readSetting("appearance.font.size",   ""),
      this.buildCustomCss(),
    ]);

    const vars = (map: TokenMap) =>
      Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n");

    const rootExtras: string[] = [];
    if (family && FONT_STACKS[family]) rootExtras.push(`  --ff-sans: ${FONT_STACKS[family]};`);
    if (weight) rootExtras.push(`  --fw-body: ${weight};`);
    if (size)   rootExtras.push(`  --fs-base: ${size}px;`);

    const lightTokenVars = vars(tokens.light);
    const lightVars = [lightTokenVars, rootExtras.join("\n")].filter(Boolean).join("\n");
    const darkVars = vars(tokens.dark);

    const parts: string[] = [];
    // Emit a theme block only when there's something to override — otherwise the
    // app inherits the bundled core tokens (tokens.scss) for that theme.
    if (lightVars.trim()) parts.push(`:root, [data-theme="light"] {\n${lightVars}\n}`);
    if (darkVars.trim())  parts.push(`[data-theme="dark"] {\n${darkVars}\n}`);

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

    const tokens: TokenSet = {
      light: parseTokens(pack.lightCss),
      dark:  parseTokens(pack.darkCss),
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
