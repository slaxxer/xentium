/**
 * Ready-made header and footer styles, at the top of the block list while the
 * Header or Footer page is open: pick one, then fine-tune. Each card is a small
 * drawing of the arrangement, so it is chosen by looking, not by reading.
 * The arrangement logic is `layout/chromePresets.ts`; this is only the picker.
 */
import { useTranslation } from "react-i18next";
import {
  FOOTER_PRESETS, HEADER_PRESETS, activeFooterPreset, activeHeaderPreset, footerPreset, headerPreset,
  type FooterPresetId, type HeaderPresetId,
} from "../../../layout/chromePresets";
import type { Regions } from "../../../layout/blockTree";
import "./ChromeStyles.scss";

/** A tiny drawing: rows of bars. `b` = band, `n` = navbar, `l` = logo, `c` = content. */
function Sketch({ id }: { id: HeaderPresetId | FooterPresetId }) {
  const rows: Record<string, React.ReactNode> = {
    below:   <><i className="cs-n"><b className="cs-l" /><b className="cs-k" /><b className="cs-a" /></i><i className="cs-b"><b className="cs-l cs-l--big" /></i></>,
    row:     <><i className="cs-n"><b className="cs-l" /><b className="cs-k" /><b className="cs-a" /></i><i className="cs-c" /></>,
    above:   <><i className="cs-b"><b className="cs-l cs-l--big" /><b className="cs-a cs-a--band" /></i><i className="cs-n"><b className="cs-k" /></i></>,
    centred: <><i className="cs-b cs-b--centre"><b className="cs-l cs-l--big" /></i><i className="cs-n cs-n--centre"><b className="cs-k" /></i></>,
    full:      <><i className="cs-c" /><i className="cs-f"><b className="cs-t" /><b className="cs-t cs-t--short" /><b className="cs-t" /><b className="cs-bar" /></i></>,
    community: <><i className="cs-c" /><i className="cs-f"><b className="cs-t" /><b className="cs-t" /><b className="cs-bar" /></i></>,
    minimal:   <><i className="cs-c" /><i className="cs-f"><b className="cs-bar" /></i></>,
  };
  return <span className="cs-sketch" aria-hidden="true">{rows[id]}</span>;
}

export function ChromeStyles({ kind, regions, onApply }: {
  kind: "header" | "footer";
  regions: Regions;
  onApply: (next: Regions) => void;
}) {
  const { t } = useTranslation("acp", { keyPrefix: "layoutEditor.styles" });
  const ids: (HeaderPresetId | FooterPresetId)[] = kind === "header" ? HEADER_PRESETS : FOOTER_PRESETS;
  const active = kind === "header" ? activeHeaderPreset(regions) : activeFooterPreset(regions);
  const apply = (id: HeaderPresetId | FooterPresetId) => onApply(kind === "header"
    ? headerPreset(regions, id as HeaderPresetId)
    : footerPreset(regions, id as FooterPresetId));

  return (
    <section className="chrome-styles">
      <div className="chrome-styles__head">
        <b>{t(kind === "header" ? "headerTitle" : "footerTitle")}</b>
        <span>{t("hint")}</span>
      </div>
      <div className="chrome-styles__grid">
        {ids.map((id) => (
          <button key={id} type="button" className={`chrome-styles__card${active === id ? " is-on" : ""}`}
            aria-pressed={active === id} onClick={() => apply(id)}>
            <Sketch id={id} />
            <span className="chrome-styles__name">{t(`preset.${id}`)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
