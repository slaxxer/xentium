/**
 * Ready-made SECTIONS, at the top of the Add tab (ADR-0012).
 *
 * A page is built section by section, so the first thing offered is a band that
 * already has its columns and something in them — not the three container blocks it
 * takes to make one. Each tile draws its column shape. Drag one onto the page (it can
 * only land between sections), or click it to add it after the selected section.
 */
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_DRAG_TYPE } from "./BlockLibrary";
import { PRESET_LAYOUT, SECTION_LAYOUTS, SECTION_PRESETS, type SectionPreset } from "../../../layout/sections";

export function SectionPresets({ onPick, onDragStart, onDragEnd }: {
  onPick: (preset: SectionPreset) => void;
  onDragStart: (preset: SectionPreset) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation("acp", { keyPrefix: "layoutEditor.sections" });

  const dragStart = (e: DragEvent<HTMLButtonElement>, preset: SectionPreset) => {
    e.dataTransfer.setData(BLOCK_DRAG_TYPE, "section");
    e.dataTransfer.setData("text/plain", t(`preset.${preset}`));
    e.dataTransfer.effectAllowed = "copy";
    onDragStart(preset);
  };

  return (
    <div className="lay-sec">
      <div className="lay-sec__head">{t("title")}</div>
      <div className="lay-sec__grid">
        {SECTION_PRESETS.map((p) => (
          <button key={p} type="button" className="lay-sec__tile" draggable
            onDragStart={(e) => dragStart(e, p)} onDragEnd={onDragEnd} onClick={() => onPick(p)}>
            <span className={`lay-sec__shape${p === "callToAction" ? " is-accent" : ""}`} aria-hidden="true">
              {SECTION_LAYOUTS[PRESET_LAYOUT[p]].map((w, i) => <i key={i} style={{ flexGrow: Number(w) }} />)}
            </span>
            <span className="lay-sec__name">{t(`preset.${p}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The five column shapes, for a selected section's settings. */
export function SectionColumnsPicker({ value, onChange }: {
  value: keyof typeof SECTION_LAYOUTS | null;
  onChange: (next: keyof typeof SECTION_LAYOUTS) => void;
}) {
  const { t } = useTranslation("acp", { keyPrefix: "layoutEditor.sections" });
  return (
    <div className="lay-sec__columns">
      <div className="lay__props-section">{t("columns")}</div>
      <div className="lay-sec__picker" role="radiogroup" aria-label={t("columns")}>
        {(Object.keys(SECTION_LAYOUTS) as (keyof typeof SECTION_LAYOUTS)[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k}
            className={`lay-sec__pick${value === k ? " is-on" : ""}`}
            title={t(`layout.${k}`)} aria-label={t(`layout.${k}`)} onClick={() => onChange(k)}>
            {SECTION_LAYOUTS[k].map((w, i) => <i key={i} style={{ flexGrow: Number(w) }} />)}
          </button>
        ))}
      </div>
      <p className="acp-hint">{value ? t("columnsHint") : t("columnsCustom")}</p>
    </div>
  );
}
