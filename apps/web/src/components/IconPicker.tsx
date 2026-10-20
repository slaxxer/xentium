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
 *
 * WITH A KIT the grid is the KIT's catalogue instead (`lib/kitIconCatalogue.ts`, read
 * from the kit's own stylesheet), drawn in the chosen style: pick a style, then pick
 * from what that style looks like. A partial Pro+ family is filtered to the glyphs it
 * actually draws. The style may be chosen before an icon — it is held here until one
 * is picked, because a style alone is not a token (see `emit`).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ICON_STYLE_DEFS, iconStyleDef, iconStyleClasses, parseIconToken, formatIconToken,
  type IconStyleGroup,
} from "@xentium/contracts";
import { FontAwesomeIcon as RawIcon } from "@fortawesome/react-fontawesome";
import { bundledIconNames, bundledIcon } from "../lib/iconCatalogue";

/** Plugins add the icons they ship to the bundled tier through this (webIconPicker). */
export { registerBundledIcons } from "../lib/iconCatalogue";
import { useIconKitReady, useIconStyle } from "../lib/iconKit";
import { kitBrandIcons, kitIconCatalogue, presentIn } from "../lib/kitIconCatalogue";
import { IconScope } from "../lib/iconScope";
import { TokenIcon } from "./TokenIcon";
import "./IconPicker.scss";

const GROUPS: IconStyleGroup[] = ["classic", "duotone", "sharp", "sharpDuotone", "proPlus"];

/** Kit cells drawn at once; "Show more" adds the next page. A kit holds thousands. */
const PAGE = 180;

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
    ? bundledIconNames().filter((n) => n.includes(query.toLowerCase()))
    : bundledIconNames();

  // A style chosen before any icon: held here, applied with the first pick.
  const [pendingStyle, setPendingStyle] = useState("");
  const activeStyle = name ? style : pendingStyle;

  // ── The kit tier ──────────────────────────────────────────────────────────
  const siteClasses = useIconStyle();
  const catalogue   = useMemo(() => (kitReady ? kitIconCatalogue() : []), [kitReady]);
  const kitMode     = catalogue.length > 0;
  /** The classes the grid draws in: the chosen style, else the site's. */
  const gridClasses = (activeStyle ? iconStyleClasses(activeStyle) : siteClasses) ?? "fa-solid";
  const partial     = activeStyle ? iconStyleDef(activeStyle)?.full === false : false;

  // Brand logos only draw in the Brands style, which the picker leaves out.
  const [brandSet, setBrandSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!kitMode) return;
    let live = true;
    void kitBrandIcons(catalogue).then((set) => { if (live) setBrandSet(set); });
    return () => { live = false; };
  }, [kitMode, catalogue]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const icons = brandSet ? catalogue.filter((i) => !brandSet.has(i.name)) : catalogue;
    return q
      ? icons.filter((i) => i.name.includes(q) || i.aliases.some((a) => a.includes(q)))
      : icons;
  }, [catalogue, brandSet, query]);

  // Which names a partial family draws, per style; filled in the background.
  const [present, setPresent] = useState<Record<string, Set<string>>>({});
  const checked = partial ? present[gridClasses] : undefined;
  useEffect(() => {
    if (!kitMode || !partial || present[gridClasses]) return;
    let live = true;
    void presentIn(gridClasses, catalogue).then((set) => {
      if (live) setPresent((p) => ({ ...p, [gridClasses]: set }));
    });
    return () => { live = false; };
  }, [kitMode, partial, gridClasses, catalogue, present]);

  const ready    = !!brandSet && (!partial || !!checked);
  /** How many icons the chosen style has, before the search narrows it. */
  const styleTotal = !brandSet ? catalogue.length
    : partial ? (checked ? [...checked].filter((n) => !brandSet.has(n)).length : 0)
    : catalogue.length - brandSet.size;
  const kitShown = !ready ? [] : partial ? matches.filter((i) => checked!.has(i.name)) : matches;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [query, gridClasses]);

  /**
   * ⚠ A style with NO NAME is not an icon, and must never be stored as one.
   *
   * `formatIconToken("sharp-solid", "")` produces `"sharp-solid:"`, which saves
   * happily, parses to nothing, and draws nothing — so picking a style before typing
   * a name looked exactly like the control was broken. An empty name clears instead.
   */
  const emit = (nextName: string, nextStyle: string) =>
    onChange(nextName ? formatIconToken(nextStyle || null, nextName) : "");

  const pinnedDef = activeStyle ? iconStyleDef(activeStyle) : undefined;

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
        value={activeStyle}
        disabled={!kitReady}
        onChange={(e) => {
          if (name) emit(name, e.target.value);
          else setPendingStyle(e.target.value);
        }}
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

      {/* Core ships Font Awesome Free; more icons come from the site's own kit
          (docs/icon-kits.md), set in Theme Studio → Branding. */}
      {!kitReady && (
        <p className="acp-hint">
          {t("iconPicker.needsKit")} <Link to="/admin/theme-studio?mode=branding">{t("iconPicker.addIcons")}</Link>
        </p>
      )}
      {!name && !kitMode && <p className="acp-hint">{t("iconPicker.needsName")}</p>}
      {pinnedDef?.full === false && (
        <p className="acp-hint">{t(kitMode ? "iconPicker.partialFiltered" : "iconPicker.partialFamily")}</p>
      )}
      {name && !bundledIcon(name) && (
        <p className="acp-hint">{t("iconPicker.notBundled")}</p>
      )}

      {kitMode && (
        <>
          <input
            className="acp-input icp__search"
            value={query}
            placeholder={t("iconPicker.searchKit", { count: styleTotal })}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="icp__grid" role="listbox" aria-label={t("iconPicker.kitIcons")}>
            {!ready && <p className="acp-hint">{t("iconPicker.checking")}</p>}
            {kitShown.slice(0, limit).map((i) => (
              <button
                key={i.name}
                type="button"
                role="option"
                aria-selected={i.name === name}
                title={i.name}
                className={`icp__cell${i.name === name ? " is-on" : ""}`}
                onClick={() => emit(i.name, activeStyle)}
              >
                {/* Raw HTML: the kit owns this node (docs/icon-kits.md). Drawn in the
                    CHOSEN style, so the grid is what the icon will look like. */}
                <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<i class="${gridClasses} fa-${i.name}"></i>` }} />
              </button>
            ))}
            {ready && kitShown.length === 0 && <p className="acp-hint">{t("iconPicker.noKitMatches")}</p>}
          </div>
          {kitShown.length > limit && (
            <button type="button" className="btn-ghost btn-sm icp__more" onClick={() => setLimit((l) => l + PAGE)}>
              {t("iconPicker.showMore", { count: kitShown.length - limit })}
            </button>
          )}
        </>
      )}

      {!kitMode && (<>
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
      </>)}
    </div>
  );
}
