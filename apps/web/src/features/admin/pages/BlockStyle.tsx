/**
 * Click-to-scope colour editing, in the layout editor's settings rail (ADR-0005).
 *
 * ## Why this is not a per-block colour picker
 *
 * The obvious version — click a block, pick a colour, store it on the block — is the
 * thing that makes theme ecosystems incoherent: colours scattered through a document
 * with no relationship to each other, dark mode broken by construction, and the Style
 * Editor reduced to decoration. It also breaks the codebase's own hard rule that a
 * visual value is always a token.
 *
 * So the block picks a **variant** — a named look — and this panel edits *that look's
 * tokens*. Two blocks set to `accent` cannot drift apart, and someone who wants
 * different colours changes six tokens instead of forty blocks. The variant lives in
 * the layout document; the tokens live in the theme. Both travel in a `.xttheme`.
 *
 * ## Two different saves, on purpose
 *
 * The variant is part of the LAYOUT draft (autosaved with the document, published with
 * Publish layouts). The tokens are part of the APPEARANCE draft (published with Publish
 * appearance). They are separate staging areas that predate this panel, and pretending
 * otherwise would mean one button publishing two things an admin only asked to publish
 * one of. The panel says which is which rather than hiding it.
 *
 * ## Where the starting values come from
 *
 * An unedited variant has no stored tokens — its look is defined in `tokens.scss` in
 * terms of palette tokens (`--surface-bg: var(--c-card)`), which is what makes a variant
 * follow the site's colours and both themes for free. To show that as a starting value
 * the panel RESOLVES it: a probe element carrying the variant class is measured with
 * `getComputedStyle`. That reads exactly what the browser would paint, rather than
 * duplicating the SCSS in TypeScript where the two could drift.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons";
import {
  BLOCK_VARIANTS,
  VARIANT_TOKEN_ROWS,
  variantClass,
  variantScopeId,
  type BlockVariant,
  type ScopedTokenSet,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { useTheme } from "../../../hooks/useTheme";

type Mode = "light" | "dark";

/** Pending edits for one variant scope, per theme. `null` = clear the override. */
type Patch = Record<Mode, Record<string, string | null>>;

const EMPTY_PATCH: Patch = { light: {}, dark: {} };

/**
 * Resolve what a variant's tokens currently compute to, by measuring the browser.
 *
 * The probe is attached to `document.body` because a custom property declared on a
 * detached element resolves against nothing — `var(--c-card)` would come back empty.
 *
 * ⚠ …and body, in here, is `body.xt-acp`, which re-declares the whole palette so the
 * admin panel does not follow the site's theme. Measuring straight against it would
 * report the ACP's colours as the SITE's — a themed site would be told its accent
 * panel is blurple. The probe therefore sits inside a `.xt-site-tokens` host, which
 * restores the defaults and receives the served stylesheet's global overrides, so
 * what is measured is what the site paints. The variant rules themselves need no
 * such help: they are emitted under `:root`, and reach any element in the document.
 */
function resolveVariantTokens(variant: BlockVariant, cssVars: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof document === "undefined") return out;
  const host = document.createElement("div");
  host.className = "xt-site-tokens";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;left:-9999px;width:0;height:0;pointer-events:none";
  const probe = document.createElement("div");
  probe.className = variantClass(variant);
  host.appendChild(probe);
  document.body.appendChild(host);
  const computed = getComputedStyle(probe);
  for (const cssVar of cssVars) out[cssVar] = computed.getPropertyValue(cssVar).trim();
  host.remove();
  return out;
}

/** `<input type="color">` only speaks `#rrggbb`, so anything else needs converting. */
function toHex(value: string, fallback = "#888888"): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    const hex = rgb.slice(1, 4)
      .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  return fallback;
}

export function BlockStyleFields({
  variant,
  onVariantChange,
  className,
  onClassNameChange,
  /** True for a block that can hold others — the ones a surface makes sense on. */
  isContainer,
  /** CSS for the preview iframe, so a token edit is visible before it is saved. */
  onPreviewCss,
}: {
  variant: BlockVariant | undefined;
  /** `undefined` = no variant, which is what an unstyled block stores. */
  onVariantChange: (next: BlockVariant | undefined) => void;
  /** `undefined` = no handle. Unlike the variant this applies to leaves too — an
   *  image tile is the case it exists for. */
  className: string | undefined;
  onClassNameChange: (next: string | undefined) => void;
  isContainer: boolean;
  onPreviewCss: (css: string) => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";

  // Unsaved token edits, so a drag on the colour input does not fire a request per
  // frame. Flushed by the debounce below.
  const [patch, setPatch] = useState<Patch>(EMPTY_PATCH);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = variant ? variantScopeId(variant) : null;

  /** The appearance DRAFT — the same set the Style Editor edits. */
  const { data: draft } = useQuery<ScopedTokenSet>({
    queryKey: ["acp-tokens"],
    queryFn:  () => api.get("/appearance/tokens"),
    staleTime: 30_000,
  });

  const cssVars = useMemo(() => VARIANT_TOKEN_ROWS.map((r) => r.cssVar), []);

  // Re-resolved per variant AND per theme: the same variant computes different values
  // in dark mode, because its definition is written in palette tokens.
  const inherited = useMemo(
    () => (variant ? resolveVariantTokens(variant, cssVars) : {}),
    [variant, cssVars, mode],
  );

  const stored = (scope && draft?.[mode]?.[scope]) || {};

  /** Saved value, then a pending edit on top; `null` means "cleared, back to inherited". */
  const valueOf = (cssVar: string): { value: string; overridden: boolean } => {
    const pending = patch[mode][cssVar];
    if (pending === null) return { value: inherited[cssVar] ?? "", overridden: false };
    if (pending !== undefined) return { value: pending, overridden: true };
    const saved = stored[cssVar];
    if (saved !== undefined) return { value: saved, overridden: true };
    return { value: inherited[cssVar] ?? "", overridden: false };
  };

  const patchMut = useMutation({
    mutationFn: (body: Patch) =>
      api.patch<ScopedTokenSet>(`/appearance/tokens/scope/${encodeURIComponent(scope!)}`, body),
    onSuccess: (next) => {
      // Seed the cache with the server's answer rather than refetching: the Style
      // Editor reads the same key, so both surfaces stay in step.
      qc.setQueryData(["acp-tokens"], next);
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      setPatch(EMPTY_PATCH);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  /**
   * Push the pending look into the preview.
   *
   * The preview iframe serves the PUBLISHED stylesheet, so a draft token edit would
   * otherwise be invisible until publish — which is the opposite of what a live preview
   * is for. Both themes are emitted so switching the previewed theme still shows it.
   */
  useEffect(() => {
    if (!variant || !scope) { onPreviewCss(""); return; }
    const blocks: string[] = [];
    for (const m of ["light", "dark"] as Mode[]) {
      const merged: Record<string, string> = { ...((draft?.[m]?.[scope]) ?? {}) };
      for (const [cssVar, v] of Object.entries(patch[m])) {
        if (v === null) delete merged[cssVar];
        else merged[cssVar] = v;
      }
      const decls = Object.entries(merged).map(([k, v]) => `  ${k}: ${v};`).join("\n");
      if (!decls) continue;
      // Mirrors the served stylesheet's own selectors, so the preview cannot show a
      // precedence the real page would not.
      const prefix = m === "light" ? `:root, [data-theme="light"]` : `[data-theme="dark"]`;
      blocks.push(`${prefix} .${variantClass(variant)} {\n${decls}\n}`);
    }
    onPreviewCss(blocks.join("\n\n"));
  }, [variant, scope, draft, patch, onPreviewCss]);

  const edit = (cssVar: string, value: string | null) => {
    setPatch((prev) => {
      const next: Patch = { light: { ...prev.light }, dark: { ...prev.dark } };
      next[mode][cssVar] = value;
      return next;
    });
    if (flushRef.current) clearTimeout(flushRef.current);
    flushRef.current = setTimeout(() => {
      // Read through the setter so the flush always sends the newest edits, not the
      // ones captured when the timer was armed.
      setPatch((current) => {
        if (Object.keys(current.light).length || Object.keys(current.dark).length) {
          patchMut.mutate(current);
        }
        return current;
      });
    }, 500);
  };

  useEffect(() => () => { if (flushRef.current) clearTimeout(flushRef.current); }, []);

  return (
    <div className="lay__style">
      <div className="lay__style-head">
        <span className="lay__vis-title">{t("layoutEditor.style")}</span>
        {/* Says WHERE a colour edited here lands: in the site's theme tokens, not on
            this block. Editing one recolours every block wearing the same variant,
            which is the point of a variant and the one thing an admin can mistake it
            for — a per-block colour. */}
        <span className="lay__style-badge">{t("layoutEditor.themeTokens")}</span>
      </div>

      {/* Deliberately outside the container branch below: a variant only makes sense
          on something with a surface, but a CSS handle is for any block at all, and
          the leaf case (an image tile in a custom navbar) is the one it was added
          for. Invalid input is rejected by `blockClassNameSchema` on save; the field
          filters the obviously-wrong characters as you type so it cannot autosave a
          document the API will refuse. */}
      <div className="lay__style-class">
        <label className="acp-label" htmlFor="xt-block-class">
          {t("layoutEditor.classNameLabel")}
        </label>
        <input
          id="xt-block-class"
          className="acp-input"
          value={className ?? ""}
          placeholder="nav-tile"
          maxLength={120}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^A-Za-z0-9_ -]/g, "");
            onClassNameChange(raw.trim() ? raw : undefined);
          }}
        />
        <p className="acp-hint lay__vis-note">{t("layoutEditor.classNameNote")}</p>
      </div>

      {!isContainer ? (
        // Honest rather than a knob that does nothing visible: a leaf has no surface of
        // its own, and a variant on it would only re-tint whatever it contains.
        <p className="acp-hint">{t("layoutEditor.variantLeaf")}</p>
      ) : (
        <>
          {/* PILLS, not a stack of radios. Five mutually exclusive one-word choices
              read as a set when they sit on one line, and the panel is 320px wide —
              the stacked version spent five rows saying what one row can.
              ⚠ Still real radios underneath: same name, same keyboard behaviour, same
              announcement. Only the drawing changed. */}
          <div className="lay__style-row" role="radiogroup"
               aria-label={t("layoutEditor.style")}>
            <label className={`lay__variant-pill${!variant ? " is-on" : ""}`}>
              <input
                type="radio" name="xt-block-variant"
                checked={!variant}
                onChange={() => onVariantChange(undefined)}
              />
              <span>{t("layoutEditor.variant.none")}</span>
            </label>
            {BLOCK_VARIANTS.map((v) => (
              <label className={`lay__variant-pill${variant === v ? " is-on" : ""}`} key={v}>
                <input
                  type="radio" name="xt-block-variant"
                  checked={variant === v}
                  onChange={() => onVariantChange(v)}
                />
                <span>{t(`layoutEditor.variant.${v}`)}</span>
              </label>
            ))}
          </div>

          {variant && (
            <div className="lay__style-tokens">
              <div className="lay__style-scope">
                {t("layoutEditor.variantScope", {
                  variant: t(`layoutEditor.variant.${variant}`),
                  theme:   t(mode === "dark" ? "layoutEditor.modeDark" : "layoutEditor.modeLight"),
                })}
              </div>

              {VARIANT_TOKEN_ROWS.map((row) => {
                const { value, overridden } = valueOf(row.cssVar);
                return (
                  <div className="lay__style-token" key={row.cssVar}>
                    <div className="lay__style-token-head">
                      <span>{t(row.label)}</span>
                      {overridden && (
                        <button type="button" className="lay__style-reset"
                          onClick={() => edit(row.cssVar, null)}
                          title={t("styleEditor.revertTitle")}>
                          <FontAwesomeIcon icon={faRotateRight} /> {t("styleEditor.reset")}
                        </button>
                      )}
                    </div>
                    <div className="lay__style-token-controls">
                      <input
                        type="color"
                        value={toHex(value)}
                        onChange={(e) => edit(row.cssVar, e.target.value)}
                        aria-label={t(row.label)}
                      />
                      {/* The text field is the escape hatch: `rgba()` and
                          `color-mix()` are legitimate token values a swatch cannot
                          express, and the picker would silently flatten them. */}
                      <input
                        className="acp-input"
                        value={value}
                        placeholder="#rrggbb"
                        onChange={(e) => edit(row.cssVar, e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}

              <p className="acp-hint lay__vis-note">{t("layoutEditor.variantTokenNote")}</p>
            </div>
          )}

          <p className="acp-hint lay__vis-note">{t("layoutEditor.variantNote")}</p>
        </>
      )}
    </div>
  );
}
