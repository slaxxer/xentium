/**
 * Edge art, in the Layout Editor's block inspector: a shape along the block's top or
 * bottom edge. Offered on EVERY block — `edges` is node-level (see contracts).
 *
 * Part of the layout document, so it autosaves with the layout draft and ships with a
 * theme; an image goes up through the same endpoint section backgrounds use.
 *
 * Shapes come from `edgeRegistry`, so a plugin's appear beside core's. A plugin's own
 * settings are its sections (`InspectorTop` / `Inspector`), handed its slice of `ext`.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faBan, faImage, faPlug, faUpload } from "@fortawesome/free-solid-svg-icons";
import {
  EDGE_ART_LIMITS,
  edgeArtSchema,
  type BlockEdges,
  type EdgeArt,
  type EdgeShape,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { Toggle, Button } from "../../../components/AcpControls";
import { edgeMask } from "../../../layout/edgeArt";
import { edgeExtensions, edgeShape, edgeShapes, type EdgeInspectorProps } from "../../../layout/edgeRegistry";
import { resolveImageSource } from "../../../layout/blocks/coreBlocks";
import { ColorRow } from "./SiteFramePopover";
import "./BlockEdgeArt.scss";

type Side = "top" | "bottom";

interface Props {
  value: BlockEdges | undefined;
  onChange: (next: BlockEdges | undefined) => void;
}

export function BlockEdgeArtFields({ value, onChange, bare }: Props & { bare?: boolean }) {
  const { t } = useTranslation("acp");
  const [side, setSide] = useState<Side>(value?.bottom || !value?.top ? "bottom" : "top");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const edge = value?.[side];

  const write = (next: EdgeArt | undefined) => onChange({ ...value, [side]: next });
  // An option set back to its stock value is DROPPED, not stored as undefined: absent
  // is the stock look, and a key left behind would keep the draft reading as edited.
  const patch = (p: Partial<EdgeArt>) => {
    if (!edge) return;
    const next = { ...edge, ...p } as Record<string, unknown>;
    for (const k of Object.keys(p)) if (next[k] === undefined) delete next[k];
    write(next as EdgeArt);
  };
  const pickShape = (picked: string | null) => {
    if (!picked) {
      // "None" removes the OUTLINE. An edge still carrying plugin art (a sky, particles)
      // keeps that art and becomes `blank`; only an edge with nothing else goes.
      if (!edge || !edge.ext || Object.keys(edge.ext).length === 0) return write(undefined);
      const { count: _c, fallback: _f, ...kept } = edge;
      return write({ ...kept, shape: "blank" });
    }
    const shape = picked as EdgeShape;
    // A plugin shape carries its stand-in, so a site without the plugin degrades on
    // purpose; a core shape needs none.
    const fallback = edgeShape(shape)?.fallback;
    if (!edge) return write(edgeArtSchema.parse({ shape, ...(fallback ? { fallback } : {}) }));
    // Switching shape keeps the colours, height and every plugin's settings.
    // The unit count is per shape (24 teeth are not 24 waves).
    const { count: _count, fallback: _fallback, ...kept } = edge;
    write({ ...kept, shape, ...(fallback ? { fallback } : {}) });
  };

  /** What an extension's inspector section is handed: its own slice of `ext`. */
  const extProps = (namespace: string): EdgeInspectorProps => ({
    edge,
    ext: edge?.ext?.[namespace],
    write,
    setExt: (next) => {
      if (!edge) return;
      const { [namespace]: _old, ...others } = edge.ext ?? {};
      const ext = next ? { ...others, [namespace]: next } : others;
      // An empty `ext` is dropped, like any other option back at its stock value.
      patch({ ext: Object.keys(ext).length ? ext : undefined });
    },
  });

  const current = edge && edge.shape !== "image" ? edgeShape(edge.shape) : undefined;
  /** The edge names a shape no enabled plugin provides. */
  const missing = !!edge && edge.shape !== "image" && !current;

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

      {edgeExtensions().map(({ namespace, InspectorTop }) =>
        InspectorTop && <InspectorTop key={namespace} {...extProps(namespace)} />)}

      <div className="lay-edge__shapes">
        {[null, ...edgeShapes().filter((d) => d.id !== "blank").map((d) => d.id), "image"].map((shape) => {
          // "None" is both no edge and a `blank` one: no outline either way.
          const on = shape === null ? !edge || edge.shape === "blank" : edge?.shape === shape;
          const def = shape && shape !== "image" ? edgeShape(shape) : undefined;
          return (
            <button key={shape ?? "none"} type="button" aria-pressed={on}
              className={`lay-edge__shape${on ? " is-on" : ""}`}
              onClick={() => pickShape(shape)}>
              <span className="lay-edge__mini" aria-hidden="true">
                {shape === null ? <FontAwesomeIcon icon={faBan} />
                  : shape === "image" ? <FontAwesomeIcon icon={faImage} />
                  : def?.icon ? <FontAwesomeIcon icon={def.icon} />
                  : <i style={{ WebkitMaskImage: edgeMask(shape, 30, 120), maskImage: edgeMask(shape, 30, 120) }} />}
              </span>
              <span>{shape === null ? t("layoutEditor.edge.shape.none")
                : shape === "image" ? t("layoutEditor.edge.shape.image")
                : t(def!.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {missing && (
        <p className="lay-edge__missing">
          <FontAwesomeIcon icon={faPlug} />{" "}
          {t(edge!.fallback ? "layoutEditor.edge.missingFallback" : "layoutEditor.edge.missing", {
            shape: edge!.shape,
            fallback: edge!.fallback ? t(`layoutEditor.edge.shape.${edge!.fallback}`) : "",
          })}
        </p>
      )}

      {/* A side with no edge yet still offers what plugins draw without an outline (a
          sky, particles); turning one on creates the edge. */}
      {!edge && edgeExtensions().map(({ namespace, Inspector }) =>
        Inspector && <Inspector key={namespace} {...extProps(namespace)} />)}

      {edge?.shape === "blank" && <p className="acp-hint">{t("layoutEditor.edge.blankHint")}</p>}

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
                <Button variant="ghost" disabled={uploading}
                  onClick={() => fileRef.current?.click()}>
                  <FontAwesomeIcon icon={faUpload} />{" "}
                  {uploading ? t("layoutEditor.bgUploading")
                    : t(edge.image ? "layoutEditor.edge.replaceImage" : "layoutEditor.edge.uploadImage")}
                </Button>
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
          ) : edge.shape === "blank" ? null : (
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
            <Toggle on={edge.mobileHeight !== undefined}
              onToggle={() => patch({ mobileHeight: edge.mobileHeight === undefined ? Math.round(edge.height / 2) : undefined })} />
            <span>
              <span>{t("layoutEditor.edge.mobileHeight")}</span>
              <span className="acp-hint">{t("layoutEditor.edge.mobileHeightHint")}</span>
            </span>
          </label>
          {edge.mobileHeight !== undefined && (
            <div className="lay-edge__range">
              <div className="lay-edge__row">
                <span>{t("layoutEditor.edge.phoneHeight")}</span>
                <code>{edge.mobileHeight ? `${edge.mobileHeight}px` : t("layoutEditor.edge.hidden")}</code>
              </div>
              <input type="range" min={EDGE_ART_LIMITS.mobileHeight.min} max={EDGE_ART_LIMITS.mobileHeight.max} step={2}
                value={edge.mobileHeight} onChange={(e) => patch({ mobileHeight: Number(e.target.value) })} />
            </div>
          )}

          {current?.unit && (
            <div className="lay-edge__range">
              <div className="lay-edge__row">
                <span>{t("layoutEditor.edge.count")}</span>
                <code>{edge.count ?? current.defaultCount}</code>
              </div>
              <input type="range" min={EDGE_ART_LIMITS.count.min} max={EDGE_ART_LIMITS.count.max}
                value={edge.count ?? current.defaultCount ?? 8}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  // The shape's own default is stored as absent, so moving back to it is no edit.
                  patch({ count: n === current.defaultCount ? undefined : n });
                }} />
            </div>
          )}

          {current?.pluginId && (
            <div className="lay-edge__row">
              <span>{t("layoutEditor.edge.fallback")}</span>
              <select className="acp-input" value={edge.fallback ?? ""}
                onChange={(e) => patch({ fallback: (e.target.value || undefined) as EdgeArt["fallback"] })}>
                <option value="">{t("layoutEditor.edge.fallbackNone")}</option>
                {edgeShapes().filter((d) => !d.pluginId).map((d) => (
                  <option key={d.id} value={d.id}>{t(d.labelKey)}</option>
                ))}
              </select>
            </div>
          )}
          {current?.pluginId && <p className="acp-hint">{t("layoutEditor.edge.fallbackHint")}</p>}

          {edgeExtensions().map(({ namespace, Inspector }) =>
            Inspector && <Inspector key={namespace} {...extProps(namespace)} />)}

          <div className="lay-edge__range">
            <div className="lay-edge__row">
              <span>{t("layoutEditor.edge.opacity")}</span>
              <code>{edge.opacity ?? 100}%</code>
            </div>
            <input type="range" min={EDGE_ART_LIMITS.opacity.min} max={EDGE_ART_LIMITS.opacity.max} step={5}
              value={edge.opacity ?? 100}
              onChange={(e) => { const v = Number(e.target.value); patch({ opacity: v === 100 ? undefined : v }); }} />
          </div>

          {edge.shape !== "blank" && (
            <label className="lay-edge__check">
              <Toggle on={edge.mirror} onToggle={() => patch({ mirror: !edge.mirror })} />
              <span>{t("layoutEditor.edge.mirror")}</span>
            </label>
          )}

          {edge.shape === "blank" && (
            <Button variant="ghost" className="lay-edge__reset" onClick={() => write(undefined)}>
              {t("layoutEditor.edge.removeAll")}
            </Button>
          )}
        </>
      )}
      <p className="acp-hint">{t("layoutEditor.edge.footnote")}</p>
    </div>
  );
}
