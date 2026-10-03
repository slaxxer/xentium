/**
 * The inspector's "Theme style" tab: the theme-wide look a block sits in.
 *
 * Colourway, corners and glow are not block settings and not a new kind of setting
 * either — each is a named set of TOKEN values (`@xentium/contracts` themeStyle.ts),
 * written into the editing theme's APPEARANCE draft like any Style Editor edit. So
 * they publish with the appearance, export in the `.xttheme`, and show up in the Style
 * Editor as the tokens they are. Blocks only read them.
 *
 * The preview serves the PUBLISHED stylesheet; `useThemeDraftCss` is what puts the
 * staged values in front of it, and the page keeps that running on both tabs.
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CORNER_MODES,
  CORNER_PRESETS,
  GLOW_PRESETS,
  HEARTH_DEFAULT_TOKENS,
  THEME_STYLE_DEFAULTS,
  cornerModeOf,
  patchFor,
  wears,
  type Colourway,
  type CornerMode,
  type ScopedTokenSet,
  type TokenMap,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { CORE_THEME_PARAM, useEditingTheme, withTheme } from "../../../lib/editingTheme";
import { useThemeLibrary } from "../components/ThemeScopePicker";
import { studioHref } from "./studioLinks";
import "./ThemeStyle.scss";

/** What `GET /appearance/tokens` answers: the admin layer, and the theme under it. */
interface AdminTokens { tokens?: ScopedTokenSet; theme?: ScopedTokenSet }

/** The tokens the readout lists — the ones a colourway, corners and glow move. */
const READOUT = [
  "--c-bg", "--c-card", "--c-border", "--c-fg", "--c-fg-muted",
  "--c-accent", "--c-accent2", "--c-surface", "--corner-cut", "--glow-accent",
] as const;

/** The editing theme's appearance draft — the query the Style Editor shares. */
export function useThemeTokens() {
  const { key } = useEditingTheme();
  return useQuery<AdminTokens>({
    queryKey: ["acp-tokens", key],
    queryFn:  () => api.get(withTheme("/appearance/tokens", key)),
    staleTime: 30_000,
  });
}

/** The editing theme's library row (null = Core), and whether it is the live one. */
export function useEditingThemeRow() {
  const { key } = useEditingTheme();
  const { data } = useThemeLibrary();
  const themes = data?.themes ?? [];
  const live = themes.find((x) => x.active)?.id ?? CORE_THEME_PARAM;
  const current = key ?? live;
  return {
    loaded: !!data,
    isCore: current === CORE_THEME_PARAM,
    theme: themes.find((x) => x.id === current) ?? null,
  };
}

/** Admin draft over what the theme ships — the global bucket the site would wear. */
function effectiveGlobal(draft: AdminTokens | undefined): TokenMap {
  return { ...(draft?.theme?.global ?? {}), ...(draft?.tokens?.global ?? {}) };
}

/**
 * The staged global tokens as CSS for the preview, or "" when nothing differs from
 * what the preview already serves.
 *
 * Every staged global token goes in, not only the theme-style ones: a value the
 * admin set in the Style Editor and has not published is part of the same draft, and
 * a preview that showed half a draft would be showing a site nobody will get. A token
 * the draft CLEARED back to the default has no value here, so the defaults of the
 * theme-style tokens are written out too — otherwise "Rounded" over a published
 * "Chamfered" would keep the cut in the preview.
 */
export function themeDraftCss(draft: AdminTokens | undefined): string {
  if (!draft) return "";
  const decls = { ...THEME_STYLE_DEFAULTS, ...effectiveGlobal(draft) };
  const body = Object.entries(decls).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  // Doubled `:root` so it outranks the served sheet whichever loads last.
  return `:root:root {\n${body}\n}`;
}

const isColour = (v: string) => /^(#|rgb|hsl|oklch|color-mix)/i.test(v.trim());

export function ThemeStyleFields({ children }: { children?: ReactNode }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { key } = useEditingTheme();
  const { theme, isCore, loaded } = useEditingThemeRow();
  const { data: draft } = useThemeTokens();

  const colourways = ((theme?.manifest as { colourways?: Colourway[] } | undefined)?.colourways) ?? [];
  const shipped = draft?.theme?.global ?? {};
  const effective = useMemo(() => effectiveGlobal(draft), [draft]);

  const corners = cornerModeOf(effective);
  const glow = wears(GLOW_PRESETS.on, effective);
  const activeCw = colourways.find((c) => wears(c.tokens, effective))?.id ?? null;

  const apply = useMutation({
    mutationFn: (tokens: Record<string, string | null>) =>
      api.patch<ScopedTokenSet>(withTheme("/appearance/tokens/scope/global", key), { tokens }),
    onSuccess: (next) => {
      qc.setQueryData(["acp-tokens", key], (prev: AdminTokens | undefined) => ({ ...prev, tokens: next }));
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const set = (tokens: TokenMap) => apply.mutate(patchFor(tokens, shipped));

  // Nothing until both answer, rather than tiles that jump when the draft lands.
  if (!loaded || !draft) return null;

  const themeName = isCore ? t("themeScope.core") : theme?.name ?? "";
  // Theme ⊕ admin, then the stock value. NOT measured from this document: the ACP's
  // served stylesheet follows the viewer's own theme cookie, not the theme being edited.
  const valueOf = (v: string) => effective[v] ?? THEME_STYLE_DEFAULTS[v] ?? HEARTH_DEFAULT_TOKENS[v] ?? "";

  return (
    <div className="lay-ts">
      <p className="lay-ts__lede">{t("layoutEditor.themeStyle.lede", { theme: themeName })}</p>

      <div className="lay__props-section">{t("layoutEditor.themeStyle.colourway")}</div>
      {colourways.length ? (
        <div className="lay-ts__cws" role="radiogroup" aria-label={t("layoutEditor.themeStyle.colourway")}>
          {colourways.map((c) => {
            const on = activeCw === c.id;
            const bg = c.tokens["--c-bg"] ?? valueOf("--c-bg");
            const acc = c.tokens["--c-accent"] ?? valueOf("--c-accent");
            const acc2 = c.tokens["--c-accent2"] ?? valueOf("--c-accent2");
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on}
                className={`lay-ts__cw${on ? " is-on" : ""}`}
                disabled={apply.isPending}
                onClick={() => set(c.tokens)}>
                {/* The colourway's own colours, as data — the tile IS the preview. */}
                <span className="lay-ts__swatch" style={{ background: bg }}>
                  <span style={{ background: acc }} />
                  <span style={{ background: acc2 }} />
                </span>
                <span className="lay-ts__cw-name">{c.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="acp-hint lay-ts__none">
          {t("layoutEditor.themeStyle.noColourways", { theme: themeName })}{" "}
          <Link to={studioHref(key, "style")}>{t("layoutEditor.themeStyle.openStyleEditor")}</Link>
        </p>
      )}

      <div className="lay-ts__row">
        <span>{t("layoutEditor.themeStyle.corners")}</span>
        <div className="lay__seg" role="group" aria-label={t("layoutEditor.themeStyle.corners")}>
          {CORNER_MODES.map((m: CornerMode) => (
            <button key={m} type="button" aria-pressed={corners === m}
              className={corners === m ? "is-on" : ""}
              disabled={apply.isPending}
              onClick={() => set(CORNER_PRESETS[m])}>
              {t(`layoutEditor.themeStyle.corner.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {corners === null && <p className="acp-hint lay-ts__note">{t("layoutEditor.themeStyle.cornersCustom")}</p>}

      <label className="lay-ts__check">
        <input type="checkbox" checked={glow} disabled={apply.isPending}
          onChange={() => set(glow ? GLOW_PRESETS.off : GLOW_PRESETS.on)} />
        {t("layoutEditor.themeStyle.glow")}
      </label>

      {children}

      <div className="lay__props-section lay-ts__tokens-head">{t("layoutEditor.themeStyle.tokens")}</div>
      <div className="lay-ts__tokens">
        {READOUT.map((v) => {
          const value = valueOf(v);
          return (
            <span key={v} className="lay-ts__token">
              <span className="lay-ts__chip" style={isColour(value) ? { background: value } : undefined} />
              <span className="lay-ts__var">{v}</span>
              <span className="lay-ts__val" title={value}>{value}</span>
            </span>
          );
        })}
      </div>
      <p className="acp-hint lay-ts__note">
        {t("layoutEditor.themeStyle.staged")}{" "}
        <Link to={studioHref(key, "style")}>{t("layoutEditor.themeStyle.openStyleEditor")}</Link>
      </p>
    </div>
  );
}
