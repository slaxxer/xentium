/**
 * Choosing an icon, wherever an icon is data.
 *
 * ⚠ TWO TIERS, and the split is the honest part. The grid is what core SHIPS: those
 * draw on every install, with no kit, forever. The name field reaches anything else
 * the site's kit happens to carry — and because a web-font kit renders a missing
 * glyph as nothing at all, with no error and no event, the PREVIEW is the only
 * ground truth. An admin sees whether their choice draws before they save it.
 *
 * That matters most for the Pro+ families (Jelly, Slab, Vellum…), which are stylised
 * sets rather than a weight of the whole library: `star` may exist in Jelly while
 * `user-astronaut` does not, and no catalogue we could ship would know reliably.
 *
 * ⚠ The style select defaults to "follow the site". Pinning is opt-in on purpose —
 * an unpinned icon restyles with the one site-wide setting, and every pin is an
 * exception carved out of that.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ICON_STYLE_DEFS, iconStyleDef, parseIconToken, formatIconToken,
  type IconStyleGroup,
} from "@nodevo/contracts";
import { FontAwesomeIcon as RawIcon } from "@fortawesome/react-fontawesome";
import { BUNDLED_ICON_NAMES, bundledIcon } from "../lib/iconCatalogue";
import { useIconKitReady } from "../lib/iconKit";
import { IconScope } from "../lib/iconScope";
import { TokenIcon } from "./TokenIcon";
import "./IconPicker.scss";

const GROUPS: IconStyleGroup[] = ["classic", "duotone", "sharp", "sharpDuotone", "proPlus"];

export interface IconPickerProps {
  value:    string | null | undefined;
  onChange: (token: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const { t }    = useTranslation("acp");
  const kitReady = useIconKitReady();
  const parsed   = parseIconToken(value);
  const name     = parsed?.name  ?? "";
  const style    = parsed?.style ?? "";

  const [query, setQuery] = useState("");
  const shown = query
    ? BUNDLED_ICON_NAMES.filter((n) => n.includes(query.toLowerCase()))
    : BUNDLED_ICON_NAMES;

  /**
   * ⚠ A style with NO NAME is not an icon, and must never be stored as one.
   *
   * `formatIconToken("sharp-solid", "")` produces `"sharp-solid:"`, which saves
   * happily, parses to nothing, and draws nothing — so picking a style before typing
   * a name looked exactly like the control was broken. An empty name clears instead.
   */
  const emit = (nextName: string, nextStyle: string) =>
    onChange(nextName ? formatIconToken(nextStyle || null, nextName) : "");

  const pinnedDef = style ? iconStyleDef(style) : undefined;

  return (
    <div className="icp">
      <div className="icp__head">
        <span className="icp__preview" aria-hidden="true">
          {/* ⚠ SITE scope, inside the ACP. This swatch exists to show what a VISITOR
              will see; drawing it with the panel's own free icons would make it lie
              about the one thing it is for — and the Pro+ families, where a glyph
              may simply not exist, are exactly where an admin needs the truth. */}
          <IconScope value="site">
            <TokenIcon token={value} />
          </IconScope>
        </span>
        <input
          className="acp-input icp__name"
          value={name}
          spellCheck={false}
          placeholder={t("iconPicker.namePlaceholder")}
          onChange={(e) => emit(e.target.value.trim().toLowerCase(), style)}
        />
      </div>

      <select
        className="acp-input icp__style"
        value={style}
        disabled={!kitReady || !name}
        onChange={(e) => emit(name, e.target.value)}
      >
        <option value="">{t("iconPicker.followSite")}</option>
        {GROUPS.map((g) => (
          <optgroup key={g} label={t(`styleEditor.iconGroup_${g}`)}>
            {ICON_STYLE_DEFS.filter((d) => d.group === g).map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {!kitReady && <p className="acp-hint">{t("iconPicker.needsKit")}</p>}
      {!name && <p className="acp-hint">{t("iconPicker.needsName")}</p>}
      {pinnedDef?.full === false && <p className="acp-hint">{t("iconPicker.partialFamily")}</p>}
      {name && !bundledIcon(name) && (
        <p className="acp-hint">{t("iconPicker.notBundled")}</p>
      )}

      <input
        className="acp-input icp__search"
        value={query}
        placeholder={t("iconPicker.searchPlaceholder")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="icp__grid" role="listbox" aria-label={t("iconPicker.bundled")}>
        {shown.map((n) => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={n === name}
            title={n}
            className={`icp__cell${n === name ? " is-on" : ""}`}
            onClick={() => emit(n, style)}
          >
              {/* ⚠ The RAW component, deliberately: the grid must NOT follow the site
                style. It is the "what core ships" tier, and drawing it through a
                partial Pro+ family fills it with missing-glyph boxes — which is
                exactly what happened the first time, and makes it impossible to
                choose a SHAPE. The preview above is where the real styling is shown. */}
            <RawIcon icon={bundledIcon(n)!} />
          </button>
        ))}
        {shown.length === 0 && <p className="acp-hint">{t("iconPicker.noMatches")}</p>}
      </div>
    </div>
  );
}
