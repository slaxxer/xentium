import { prisma } from "../../infrastructure/db.js";
import AdmZip from "adm-zip";

// Hearth palette — must stay in sync with apps/web/src/styles/tokens.scss.
// These are the editable semantic tokens served via /api/appearance/css.
export const DEFAULT_TOKENS = {
  light: {
    "--c-bg":         "#f7f2ee",
    "--c-surface":    "#ffffff",
    "--c-card":       "#ffffff",
    "--c-accent":     "#6d56e6",
    "--c-accent2":    "#ff7a59",
    "--c-accent-soft":  "#ece8fc",
    "--c-accent2-soft": "#ffe9e2",
    "--c-fg":         "#2b2535",
    "--c-fg-muted":   "#6f6878",
    "--c-fg-subtle":  "#a39caf",
    "--c-border":     "#efe9e3",
    "--c-success":    "#1fab74",
    "--c-warn":       "#f4a259",
    "--c-danger":     "#ef4444",
    "--card-radius":  "14px",
    "--btn-radius":   "10px",
  },
  dark: {
    "--c-bg":         "#14101c",
    "--c-surface":    "#1d1730",
    "--c-card":       "#211a36",
    "--c-accent":     "#8b78ff",
    "--c-accent2":    "#ff8a6a",
    "--c-accent-soft":  "rgba(139, 120, 255, 0.15)",
    "--c-accent2-soft": "rgba(255, 138, 106, 0.15)",
    "--c-fg":         "#f0ecf7",
    "--c-fg-muted":   "#aaa1bd",
    "--c-fg-subtle":  "#736b85",
    "--c-border":     "rgba(255, 255, 255, 0.08)",
    "--c-success":    "#34d399",
    "--c-warn":       "#f4a259",
    "--c-danger":     "#f87171",
    "--card-radius":  "14px",
    "--btn-radius":   "10px",
  },
} as const;

export type TokenMap = Record<string, string>;
export type TokenSet = { light: TokenMap; dark: TokenMap };

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

export const appearanceService = {
  async getTokens(): Promise<TokenSet> {
    const [light, dark] = await Promise.all([
      readSetting("appearance.tokens.light", DEFAULT_TOKENS.light as TokenMap),
      readSetting("appearance.tokens.dark",  DEFAULT_TOKENS.dark  as TokenMap),
    ]);
    return { light, dark };
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
  },

  async restoreHistory(historyId: string, savedById: string): Promise<TokenSet> {
    const entry  = await prisma.styleHistory.findUniqueOrThrow({ where: { id: historyId } });
    const tokens = entry.tokens as unknown as TokenSet;
    await this.saveTokens(tokens, savedById, `Restored: ${entry.label}`);
    return tokens;
  },

  async buildCSS(tokens: TokenSet): Promise<string> {
    const [family, weight, size] = await Promise.all([
      readSetting("appearance.font.family", ""),
      readSetting("appearance.font.weight", ""),
      readSetting("appearance.font.size",   ""),
    ]);

    const vars = (map: TokenMap) =>
      Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n");

    const rootExtras: string[] = [];
    if (family && FONT_STACKS[family]) rootExtras.push(`  --ff-sans: ${FONT_STACKS[family]};`);
    if (weight) rootExtras.push(`  --fw-body: ${weight};`);
    if (size)   rootExtras.push(`  --fs-base: ${size}px;`);

    const lightVars = vars(tokens.light) + (rootExtras.length ? "\n" + rootExtras.join("\n") : "");

    const parts: string[] = [];
    parts.push(`:root, [data-theme="light"] {\n${lightVars}\n}`);
    parts.push(`[data-theme="dark"] {\n${vars(tokens.dark)}\n}`);

    if (family || weight || size) {
      const bodyRules: string[] = [];
      if (family) bodyRules.push(`  font-family: var(--ff-sans);`);
      if (size)   bodyRules.push(`  font-size: var(--fs-base);`);
      if (weight) bodyRules.push(`  font-weight: var(--fw-body);`);
      parts.push(`body, input, textarea, select, button {\n${bodyRules.join("\n")}\n}`);
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
