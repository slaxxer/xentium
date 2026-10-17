/**
 * The `section` background, in the layout editor's settings rail.
 *
 * ## Why this is a panel and not three form fields
 *
 * The rail's generic `SchemaFields` renders whatever a Zod schema describes, which
 * for these three props would be a text box you paste a path into, a number, and —
 * for the gradient, an array — nothing at all. An admin choosing a masthead
 * background wants to see the picture and the colours, so this panel owns the three
 * props and `SchemaFields` is told to skip them.
 *
 * ## Why the colours are on the block, when variants exist
 *
 * `BlockStyle` argues at length that a per-block colour picker is what makes theme
 * ecosystems incoherent, and that argument still holds for a block's SURFACE — which
 * is why the variant system exists and why this panel does not touch it. A gradient
 * background is the deliberate exception: it is an image made of colours, chosen for
 * one specific band, and there is no sensible way to express "this masthead's
 * three-stop gradient" as a shared named look that other blocks could adopt.
 *
 * The escape hatch stays open, though: a stop may be written as `var(--c-accent)`,
 * and a stop written that way follows the site's palette and both light and dark for
 * free. The picker writes hex because a picker can only write hex; the text field
 * next to it accepts either, which is what a theme author will use.
 *
 * ## Two things that are NOT staged separately
 *
 * Unlike `BlockStyle` — where the variant is layout and the tokens are appearance —
 * everything here is a block prop, so it is all part of the LAYOUT draft and lands
 * with the same Publish. No second staging area to explain.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faTrash, faUpload, faPlus } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { resolveImageSource, sectionBackground } from "../../../layout/blocks/coreBlocks";

/** The props this panel owns. `SchemaFields` is given the same list to skip. */
export const BACKGROUND_PROPS = ["backgroundImage", "backgroundGradient", "backgroundAngle"] as const;

/** The most a section may carry — the schema caps the array at the same number, so a
 *  hand-written document cannot exceed what the editor offers. */
const MAX_STOPS = 3;

/** Directions worth a click. The stored value is degrees, so a theme may still use
 *  any angle; this is the set an admin is offered rather than a limit on the prop. */
const ANGLES = [180, 0, 90, 270, 135, 315, 45, 225] as const;

/** A picker can only hold a hex value. Anything else — `var(--c-accent)`, `rgb(…)` —
 *  is valid, editable as text, and simply not representable in the swatch. */
const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim());

/**
 * What a stop LOOKS like, for the swatch. A token stop (`var(--masthead-from)`) is
 * resolved on the preview page, which carries the theme's real values; this page is
 * the ACP and has none of them. A swatch drawn black for a teal band said the stop
 * was black. Anything that cannot be resolved to a hex still falls back to black —
 * the text field beside it is the truth either way.
 */
function swatchFor(stop: string): string {
  const v = stop.trim();
  if (isHex(v)) return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v.slice(0, 7);
  const token = /^var\((--[\w-]+)\)$/.exec(v)?.[1];
  const root = document.querySelector<HTMLIFrameElement>(".lay__frame iframe")?.contentDocument?.documentElement;
  if (!token || !root) return "#000000";
  const raw = getComputedStyle(root).getPropertyValue(token).trim();
  if (isHex(raw)) return swatchFor(raw);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(raw);
  return rgb ? `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : "#000000";
}

interface Props {
  image:     string | undefined;
  gradient:  string[] | undefined;
  angle:     number | undefined;
  onChange:  (patch: { backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number }) => void;
  /**
   * This block's surface is already painted elsewhere, so an empty panel means
   * "inheriting" rather than "blank".
   *
   * True for the footer, whose colours are the Style Editor's Footer panel. Anything
   * set here is drawn OVER that, and clearing it hands the block back.
   */
  inherits?: boolean;
  /** Show one half only — the header's Image | Gradient choice decides which paints. */
  only?: "image" | "gradient";
  /** No title / preview / note: the caller frames it (the header's own settings). */
  bare?: boolean;
}

export function BlockBackgroundFields({ image, gradient, angle, onChange, inherits, only, bare }: Props) {
  const { t } = useTranslation("acp");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const stops = gradient ?? [];
  const currentAngle = angle ?? 180;

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // The stored PATH is what the document holds, never the URL: the theme
      // exporter reads the path off disk to copy the bytes into the package, and a
      // URL would leave it with nothing to find.
      const res = await api.post<{ path: string }>("/admin/layouts/images", fd);
      onChange({ backgroundImage: res.path });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setUploading(false);
      // Cleared so re-picking the SAME file fires `change` again — otherwise a
      // failed upload cannot be retried without choosing a different file.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const setStop = (i: number, value: string) => {
    const next = [...stops];
    next[i] = value;
    onChange({ backgroundGradient: next });
  };

  const preview = sectionBackground({
    backgroundImage: image, backgroundGradient: stops, backgroundAngle: currentAngle,
  });

  return (
    <div className="lay-bg">
      {!bare && <div className="lay-bg__title">{t("layoutEditor.bgTitle")}</div>}

      {/* What the two halves actually compose to. The rail is narrow and a gradient
          angle is impossible to hold in your head — showing the result is cheaper
          than describing it. */}
      {!bare && <div
        className="lay-bg__preview"
        style={preview ? { backgroundImage: preview } : undefined}
      >
        {/* ⚠ "No background" is not true of every block. The footer is PAINTED by
            the Style Editor (`--footer-bg` under `SCOPE_SELECTOR.footer`), so an
            empty panel there means "inheriting", not "blank" — and an admin told
            the wrong one of those goes looking for a colour control that already
            exists somewhere else. What is empty here is the block's OVERRIDE. */}
        {!preview && <span>{t(inherits ? "layoutEditor.bgInherits" : "layoutEditor.bgNone")}</span>}
      </div>}

      {/* ── Image ─────────────────────────────────────────────────────────── */}
      {only !== "gradient" && <div className="lay-bg__row">
        <span className="lay-bg__label">{t("layoutEditor.bgImage")}</span>
        {image ? (
          <div className="lay-bg__file">
            <img src={resolveImageSource(image)} alt="" />
            <button type="button" className="btn-ghost btn-sm"
              onClick={() => onChange({ backgroundImage: "" })}>
              <FontAwesomeIcon icon={faTrash} /> {t("layoutEditor.bgRemove")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-ghost btn-sm" disabled={uploading}
            onClick={() => fileRef.current?.click()}>
            <FontAwesomeIcon icon={faUpload} />{" "}
            {uploading ? t("layoutEditor.bgUploading") : t("layoutEditor.bgUpload")}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
      </div>}

      {/* ── Gradient ──────────────────────────────────────────────────────── */}
      {only !== "image" && <div className="lay-bg__row">
        <span className="lay-bg__label">{t("layoutEditor.bgGradient")}</span>

        {stops.map((stop, i) => (
          <div className="lay-bg__stop" key={i}>
            <input
              type="color"
              // A token stop shows the colour the theme gives it (swatchFor); picking
              // a colour here replaces the token with that colour.
              value={swatchFor(stop)}
              onChange={(e) => setStop(i, e.target.value)}
              aria-label={t("layoutEditor.bgStop", { n: i + 1 })}
            />
            <input
              className="acp-input"
              value={stop}
              placeholder="#1b1e36"
              onChange={(e) => setStop(i, e.target.value)}
            />
            <button type="button" className="lay-bg__x"
              title={t("layoutEditor.bgRemoveStop")}
              /*
               * ⚠ Removing the LAST stop clears the prop, it does not store `[]`.
               *
               * An empty array and an absent key render identically, so both are
               * "no gradient" — but draft-vs-published is a `JSON.stringify`
               * comparison, so a block left holding `backgroundGradient: []` reads
               * as changed for ever. The toolbar says "Draft is ahead of the live
               * site" about an edit that was undone, and a theme update declines
               * the template as customised. Same rule as `visibility` and
               * `variant`: the default is never written down.
               */
              onClick={() => {
                const next = stops.filter((_, j) => j !== i);
                onChange({ backgroundGradient: next.length ? next : undefined });
              }}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        ))}

        {stops.length < MAX_STOPS && (
          <button type="button" className="btn-ghost btn-sm"
            onClick={() => onChange({ backgroundGradient: [...stops, "#1b1e36"] })}>
            <FontAwesomeIcon icon={faPlus} />{" "}
            {t(stops.length === 0 ? "layoutEditor.bgAddFirst" : "layoutEditor.bgAddStop")}
          </button>
        )}

        {/* One colour is a flat fill, which is a legitimate thing to want and not
            obviously a "gradient" — so the panel says so rather than looking broken. */}
        {stops.length === 1 && <div className="acp-hint">{t("layoutEditor.bgOneStop")}</div>}
      </div>}

      {/* Direction is meaningless with nothing to point, so it appears with the
          second stop rather than sitting permanently disabled. */}
      {only !== "image" && stops.length > 1 && (
        <div className="lay-bg__row">
          <span className="lay-bg__label">{t("layoutEditor.bgAngle")}</span>
          <select className="acp-input" value={currentAngle}
            onChange={(e) => onChange({ backgroundAngle: Number(e.target.value) })}>
            {ANGLES.map((a) => (
              <option key={a} value={a}>{t(`layoutEditor.bgAngle${a}`)}</option>
            ))}
            {/* A theme may ship any angle; keep it selectable rather than snapping
                the admin's document to the nearest one we happen to offer. */}
            {!ANGLES.includes(currentAngle as (typeof ANGLES)[number]) && (
              <option value={currentAngle}>{currentAngle}°</option>
            )}
          </select>
        </div>
      )}

      {!bare && <div className="acp-hint lay-bg__note">{t("layoutEditor.bgNote")}</div>}
    </div>
  );
}
