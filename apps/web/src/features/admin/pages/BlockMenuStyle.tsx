/**
 * The header's dropdowns and action pill, edited from the layout editor.
 *
 * Selecting the bell, the moderation shield, the account menu or a plugin's header
 * button shows the "Menus & dropdowns" and "User menu" tokens here, the same ones
 * Theme Studio's Colours & type lists. They are THEME tokens, not block props: every
 * dropdown on the site shares them, so editing them from one block restyles all of
 * them, and the panel says so.
 *
 * Edits go into the editing theme's appearance DRAFT (global scope, one-bucket PATCH,
 * like the variant panel) and into the shared `acp-tokens` cache straight away, which
 * is what the preview's staged-token stylesheet (`themeDraftCss`) is built from — so
 * the open dropdown in the preview follows a colour drag before the save lands.
 */
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { TOKEN_REGISTRY, type ScopedTokenSet, type TokenGroup } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { useEditingTheme, withTheme } from "../../../lib/editingTheme";
import { useThemeTokens } from "./ThemeStyle";
import { tokenLabel } from "./styleTokens";
import { ColorInput } from "../../../components/ColorInput";

interface AdminTokens { tokens?: ScopedTokenSet; theme?: ScopedTokenSet }

const WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"];

/** Which token groups a selected block opens. `null` = none (no panel). */
export function menuGroupsFor(type: string): TokenGroup[] | null {
  if (type === "userMenu") return ["usermenu", "menu"];
  if (type === "notifications" || type === "modTool" || type === "headerWidgets" || type.startsWith("slot.headerWidget.")) return ["menu", "usermenu"];
  return null;
}

/** What a token computes to on the SITE (not the ACP), for the starting value. */
function resolveSiteTokens(vars: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof document === "undefined") return out;
  // `.xt-site-tokens` restores the site's palette inside the ACP; see BlockStyle.tsx.
  const host = document.createElement("div");
  host.className = "xt-site-tokens";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;left:-9999px;width:0;height:0;pointer-events:none";
  document.body.appendChild(host);
  const cs = getComputedStyle(host);
  for (const v of vars) out[v] = cs.getPropertyValue(v).trim();
  host.remove();
  return out;
}

function toHex(value: string, fallback = "#888888"): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0")).join("")}`;
  return fallback;
}

export function BlockMenuStyle({ groups }: { groups: TokenGroup[] }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { key } = useEditingTheme();
  const { data: draft } = useThemeTokens();

  const rows = useMemo(
    () => groups.map((g) => ({ group: g, defs: TOKEN_REGISTRY.filter((d) => d.group === g && d.editable) })),
    [groups],
  );
  const vars = useMemo(() => rows.flatMap((r) => r.defs.map((d) => d.var)), [rows]);
  const inherited = useMemo(() => resolveSiteTokens(vars), [vars]);

  const pending = useRef<Record<string, string | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (tokens: Record<string, string | null>) =>
      api.patch<ScopedTokenSet>(withTheme("/appearance/tokens/scope/global", key), { tokens }),
    onSuccess: (next) => {
      qc.setQueryData(["acp-tokens", key], (prev: AdminTokens | undefined) => ({ ...prev, tokens: next }));
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!draft) return null;
  const own = draft.tokens?.global ?? {};
  const shipped = draft.theme?.global ?? {};

  const edit = (cssVar: string, value: string | null) => {
    // Into the shared cache first: the preview's staged stylesheet is built from it.
    qc.setQueryData(["acp-tokens", key], (prev: AdminTokens | undefined) => {
      const global = { ...(prev?.tokens?.global ?? {}) };
      if (value === null) delete global[cssVar]; else global[cssVar] = value;
      return { ...prev, tokens: { ...(prev?.tokens ?? {}), global } };
    });
    pending.current[cssVar] = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const tokens = pending.current;
      pending.current = {};
      save.mutate(tokens);
    }, 400);
  };

  return (
    <div className="lay__style">
      {rows.map(({ group, defs }) => (
        <div key={group} className="lay__style-tokens">
          <div className="lay__style-head">
            <span className="lay__vis-title">{t(group === "menu" ? "styleEditor.secMenu" : "styleEditor.secUserMenu")}</span>
            <span className="lay__style-badge">{t("layoutEditor.themeTokens")}</span>
          </div>
          {defs.map((d) => {
            const set = own[d.var];
            const value = set ?? shipped[d.var] ?? inherited[d.var] ?? "";
            return (
              <div className="lay__style-token" key={d.var}>
                <div className="lay__style-token-head">
                  <span>{tokenLabel(d.var, t)}</span>
                  {set !== undefined && (
                    <button type="button" className="lay__style-reset" onClick={() => edit(d.var, null)}
                      title={t("styleEditor.revertTitle")}>
                      <FontAwesomeIcon icon={faRotateRight} /> {t("styleEditor.reset")}
                    </button>
                  )}
                </div>
                <div className="lay__style-token-controls">
                  {d.control === "weight" ? (
                    <select className="acp-select" value={value} aria-label={tokenLabel(d.var, t)}
                      onChange={(e) => edit(d.var, e.target.value)}>
                      {!WEIGHTS.includes(value) && <option value={value}>{value}</option>}
                      {WEIGHTS.map((w) => <option key={w} value={w}>{t(`styleEditor.weight.${w}`)} ({w})</option>)}
                    </select>
                  ) : d.control === "radius" ? (
                    <>
                      <input type="range" min={0} max={32} value={parseFloat(value) || 0}
                        aria-label={tokenLabel(d.var, t)}
                        onChange={(e) => edit(d.var, `${e.target.value}px`)} />
                      <span className="acp-hint">{value}</span>
                    </>
                  ) : (
                    <>
                      <ColorInput value={toHex(value)} aria-label={tokenLabel(d.var, t)}
                        onChange={(v) => edit(d.var, v)} />
                      {/* The text field keeps rgba()/color-mix() values a swatch would flatten. */}
                      <input className="acp-input" value={value} placeholder="#rrggbb"
                        onChange={(e) => edit(d.var, e.target.value)} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <p className="acp-hint lay__vis-note">{t("layoutEditor.menuTokensNote")}</p>
    </div>
  );
}
