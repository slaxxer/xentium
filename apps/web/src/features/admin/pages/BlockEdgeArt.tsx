/**
 * Edge art, in the Layout Editor's block inspector: a shape along the block's top or
 * bottom edge. Offered on EVERY block — `edges` is node-level (see contracts).
 *
 * Part of the layout document, so it autosaves with the layout draft and ships with a
 * theme; an image goes up through the same endpoint section backgrounds use.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faBan, faImage, faUpload } from "@fortawesome/free-solid-svg-icons";
import {
  EDGE_ART_LIMITS,
  EDGE_SHAPES,
  edgeArtSchema,
  type BlockEdges,
  type EdgeArt,
  type EdgeShape,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { Toggle } from "../../../components/AcpControls";
import { edgeMask } from "../../../layout/edgeArt";
import { resolveImageSource } from "../../../layout/blocks/coreBlocks";
import { ColorRow } from "./SiteFramePopover";
import "./BlockEdgeArt.scss";

type Side = "top" | "bottom";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** `MM-DD` from a month and a day, the day clamped to what the month can hold. */
const monthDay = (m: string, d: number) => {
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m) - 1] ?? 31;
  return `${m}-${String(Math.min(Math.max(1, d || 1), max)).padStart(2, "0")}`;
};

interface Props {
  value: BlockEdges | undefined;
  onChange: (next: BlockEdges | undefined) => void;
}

export function BlockEdgeArtFields({ value, onChange, bare }: Props & { bare?: boolean }) {
  const { t, i18n } = useTranslation("acp");
  const [side, setSide] = useState<Side>(value?.bottom || !value?.top ? "bottom" : "top");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const edge = value?.[side];

  const write = (next: EdgeArt | undefined) => onChange({ ...value, [side]: next });
  const patch = (p: Partial<EdgeArt>) => { if (edge) write({ ...edge, ...p }); };
  const pickShape = (shape: EdgeShape | null) => {
    if (!shape) return write(undefined);
    // Switching shape keeps the colours, height and season the admin already chose.
    write(edge ? { ...edge, shape } : edgeArtSchema.parse({ shape }));
  };

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // The stored PATH, never the URL — the theme exporter reads the path off disk.
      const res = await api.post<{ path: string }>("/admin/layouts/images", fd);
      patch({ image: res.path });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const monthName = (m: string) =>
    new Date(2000, Number(m) - 1, 1).toLocaleString(i18n.language, { month: "short" });

  const seasonEnd = (which: "from" | "to") => {
    const md = edge?.season?.[which] ?? "10-01";
    const [m, d] = md.split("-");
    const set = (next: string) => edge?.season && patch({ season: { ...edge.season, [which]: next } });
    return (
      <span className="lay-edge__date">
        <select className="acp-input" value={m} aria-label={t(`layoutEditor.edge.${which}`)}
          onChange={(e) => set(monthDay(e.target.value, Number(d)))}>
          {MONTHS.map((mm) => <option key={mm} value={mm}>{monthName(mm)}</option>)}
        </select>
        <input className="acp-input" type="number" min={1} max={31} value={Number(d)}
          aria-label={t(`layoutEditor.edge.${which}Day`)}
          onChange={(e) => set(monthDay(m!, Number(e.target.value)))} />
      </span>
    );
  };

  return (
    <div className="lay-edge">
      {!bare && <div className="lay__props-section">{t("layoutEditor.edge.title")}</div>}

      <div className="lay__seg" role="tablist">
        {(["top", "bottom"] as Side[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s}
            className={side === s ? "is-on" : ""} onClick={() => setSide(s)}>
            {t(`layoutEditor.edge.${s}`)}
            {value?.[s] && <span className="lay-edge__dot" aria-label={t("layoutEditor.edge.hasArt")} />}
          </button>
        ))}
      </div>

      <div className="lay-edge__shapes">
        {[null, ...EDGE_SHAPES].map((shape) => {
          const on = (edge?.shape ?? null) === shape;
          return (
            <button key={shape ?? "none"} type="button" aria-pressed={on}
              className={`lay-edge__shape${on ? " is-on" : ""}`}
              onClick={() => pickShape(shape)}>
              <span className="lay-edge__mini" aria-hidden="true">
                {shape === null ? <FontAwesomeIcon icon={faBan} />
                  : shape === "image" ? <FontAwesomeIcon icon={faImage} />
                  : <i style={{ WebkitMaskImage: edgeMask(shape, 30, 120), maskImage: edgeMask(shape, 30, 120) }} />}
              </span>
              <span>{t(`layoutEditor.edge.shape.${shape ?? "none"}`)}</span>
            </button>
          );
        })}
      </div>

      {edge && (
        <>
          <div className="lay-edge__row">
            <span>{t("layoutEditor.edge.direction")}</span>
            <div className="lay__seg">
              {(["out", "in"] as const).map((d) => (
                <button key={d} type="button" className={edge.direction === d ? "is-on" : ""}
                  onClick={() => patch({ direction: d })}>
                  {t(`layoutEditor.edge.dir.${d}`)}
                </button>
              ))}
            </div>
          </div>
          <p className="acp-hint">{t(`layoutEditor.edge.dirHint.${side}-${edge.direction}`)}</p>

          {edge.shape === "image" ? (
            <>
              <div className="lay-edge__image">
                {edge.image && (
                  <span className="lay-edge__thumb" style={{ backgroundImage: `url("${resolveImageSource(edge.image)}")` }} />
                )}
                <button type="button" className="btn-ghost btn-sm" disabled={uploading}
                  onClick={() => fileRef.current?.click()}>
                  <FontAwesomeIcon icon={faUpload} />{" "}
                  {uploading ? t("layoutEditor.bgUploading")
                    : t(edge.image ? "layoutEditor.edge.replaceImage" : "layoutEditor.edge.uploadImage")}
                </button>
                <input ref={fileRef} type="file" hidden accept="image/png,image/svg+xml,image/webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
              </div>
              <p className="acp-hint">{t("layoutEditor.edge.imageHint")}</p>
              <div className="lay-edge__row">
                <span>{t("layoutEditor.edge.fit")}</span>
                <div className="lay__seg">
                  {(["repeat", "stretch"] as const).map((f) => (
                    <button key={f} type="button" className={edge.fit === f ? "is-on" : ""}
                      onClick={() => patch({ fit: f })}>
                      {t(`layoutEditor.edge.fitOpt.${f}`)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="lay-edge__row">
                <span>{t("layoutEditor.edge.fill")}</span>
                <div className="lay__seg">
                  <button type="button" className={edge.colors.length === 1 ? "is-on" : ""}
                    onClick={() => patch({ colors: [edge.colors[0]!] })}>
                    {t("layoutEditor.edge.fillColor")}
                  </button>
                  <button type="button" className={edge.colors.length === 2 ? "is-on" : ""}
                    onClick={() => patch({ colors: [edge.colors[0]!, edge.colors[1] ?? edge.colors[0]!] })}>
                    {t("layoutEditor.edge.fillGradient")}
                  </button>
                </div>
              </div>
              {edge.colors.map((c, i) => (
                <ColorRow key={i} value={c}
                  onChange={(v) => patch({ colors: edge.colors.map((x, j) => (j === i ? v : x)) })} />
              ))}
              <p className="acp-hint">{t("layoutEditor.edge.tokenHint")}</p>
            </>
          )}

          <div className="lay-edge__range">
            <div className="lay-edge__row">
              <span>{t("layoutEditor.edge.height")}</span>
              <code>{edge.height}px</code>
            </div>
            <input type="range" min={EDGE_ART_LIMITS.height.min} max={EDGE_ART_LIMITS.height.max} step={2}
              value={edge.height} onChange={(e) => patch({ height: Number(e.target.value) })} />
          </div>

          <label className="lay-edge__check">
            <Toggle on={edge.mirror} onToggle={() => patch({ mirror: !edge.mirror })} />
            <span>{t("layoutEditor.edge.mirror")}</span>
          </label>

          <label className="lay-edge__check">
            <Toggle on={!!edge.season}
              onToggle={() => patch({ season: edge.season ? undefined : { from: "10-01", to: "11-01" } })} />
            <span>
              <span>{t("layoutEditor.edge.season")}</span>
              <span className="acp-hint">{t("layoutEditor.edge.seasonHint")}</span>
            </span>
          </label>
          {edge.season && (
            <div className="lay-edge__season">
              <span>{t("layoutEditor.edge.from")}</span>{seasonEnd("from")}
              <span>{t("layoutEditor.edge.to")}</span>{seasonEnd("to")}
            </div>
          )}
        </>
      )}
      <p className="acp-hint">{t("layoutEditor.edge.footnote")}</p>
    </div>
  );
}
