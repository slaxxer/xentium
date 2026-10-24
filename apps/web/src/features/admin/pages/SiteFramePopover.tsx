/**
 * The Layout Editor's "Site layout" popover: how the whole site sits in the window.
 *
 * The frame is ONE document for the whole site (`@site-frame` in `xcf_layouts`), with
 * the per-page overrides inside it — see `packages/contracts/src/siteFrame.ts` for why
 * they are not on each page's own layout. It autosaves to its own draft and goes live
 * with the editor's Publish, which counts it as one more pending document.
 *
 * Always mounted, even while closed: the toolbar button names the frame the preview is
 * wearing, and the preview needs the working frame from the moment it loads.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faArrowUp, faChevronDown, faCircleDot, faPlus, faRotateLeft, faUpload, faWindowRestore, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  FRAME_LIMITS,
  FRAME_MODES,
  FRAME_PAGE_TEMPLATES,
  frameBackgroundCss,
  frameModeFor,
  parseSiteFrame,
  type FrameMode,
  type FramePageTemplate,
  type SiteFrame,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { useDebouncedSave } from "../../../hooks/useAutosave";
import { withTheme } from "../../../lib/editingTheme";
import { Toggle, Button } from "../../../components/AcpControls";
import { resolveImageSource } from "../../../layout/blocks/coreBlocks";
import "./SiteFramePopover.scss";
import { ColorInput } from "../../../components/ColorInput";

export const FRAME_QUERY_KEY = ["acp-layout-frame"] as const;

interface FrameDraftResponse {
  frame: SiteFrame;
  version: string | null;
  theme: SiteFrame | null;
  themeName: { name: string; version: string } | null;
}

/** The routes each overridable page answers on, for the per-page list. */
const PAGE_ROUTES: Record<FramePageTemplate, string> = {
  "home":           "/",
  "article.index":  "/articles",
  "article.detail": "/articles/:slug",
  "profile":        "/u/:username",
  "members":        "/members",
};

/** 3×3 compass; the centre cell is radial. */
const COMPASS: ({ angle: number } | { radial: true })[] = [
  { angle: 315 }, { angle: 0 }, { angle: 45 },
  { angle: 270 }, { radial: true }, { angle: 90 },
  { angle: 225 }, { angle: 180 }, { angle: 135 },
];

/** The colour a third stop starts as — Xentium cyan, so it is visibly a new stop. */
const THIRD_STOP = "#00b1cf";

const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim());

interface Props {
  /** The page the preview shows, when it is one that may wear its own frame. */
  pageKey: string | null;
  /** The working frame, for the preview. Called on load and on every edit. */
  onLiveChange: (frame: SiteFrame) => void;
  /** The theme being edited — each theme has its own frame. `null` = the live one. */
  themeKey?: string | null;
}

export function SiteFramePopover({ pageKey, onLiveChange, themeKey = null }: Props) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef<string | null>(null);

  const query = useQuery<FrameDraftResponse>({
    queryKey: [...FRAME_QUERY_KEY, themeKey],
    queryFn:  () => api.get(withTheme("/admin/layouts/frame", themeKey)),
  });

  const [frame, setFrame] = useState<SiteFrame | null>(null);
  // Uploaded this session, so switching between two candidates needs no re-upload.
  const [library, setLibrary] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Adopt the server's frame whenever it changes underneath us (load, publish, revert).
  useEffect(() => {
    if (!query.data) return;
    versionRef.current = query.data.version;
    setFrame(parseSiteFrame(query.data.frame));
  }, [query.data]);

  // Through a ref, so a parent passing a fresh callback each render does not re-push.
  const onLiveRef = useRef(onLiveChange);
  onLiveRef.current = onLiveChange;
  useEffect(() => { if (frame) onLiveRef.current(frame); }, [frame]);

  const save = useMutation({
    mutationFn: (next: SiteFrame) => api.put<FrameDraftResponse>(withTheme("/admin/layouts/frame", themeKey), {
      frame: next, baseVersion: versionRef.current,
    }),
    onSuccess: (res) => {
      versionRef.current = res.version;
      // Written straight into the cache so autosave's baseline moves with it; a
      // refetch would round-trip to learn what we just sent.
      qc.setQueryData([...FRAME_QUERY_KEY, themeKey], res);
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
    },
    onError: (e) => {
      // Someone else saved the frame first. Theirs wins; saying so beats a silent
      // overwrite, and the frame is small enough to redo.
      if ((e as { status?: number }).status === 409) {
        toast.warning(t("layoutEditor.frame.conflict"));
        void qc.invalidateQueries({ queryKey: FRAME_QUERY_KEY });
        return;
      }
      toast.error(apiErrorMessage(e));
    },
  });

  useDebouncedSave({
    value: frame,
    savedValue: query.data ? parseSiteFrame(query.data.frame) : undefined,
    onSave: (v) => { if (v) save.mutate(v); },
  });

  const revert = useMutation({
    mutationFn: () => api.post<FrameDraftResponse>(withTheme("/admin/layouts/frame/revert-theme", themeKey)),
    onSuccess: (res) => {
      qc.setQueryData([...FRAME_QUERY_KEY, themeKey], res);
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // Close on an outside click and on Escape, like the draft-actions menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!frame) return null;

  const set = (patch: Partial<SiteFrame>) => setFrame((f) => (f ? { ...f, ...patch } : f));
  const setBg = (patch: Partial<SiteFrame["background"]>) =>
    setFrame((f) => (f ? { ...f, background: { ...f.background, ...patch } } : f));
  const setOverride = (key: FramePageTemplate, mode: FrameMode | "") =>
    setFrame((f) => {
      if (!f) return f;
      // ⚠ Back to the default DELETES the key — `{home: ''}` would read as pending forever.
      const overrides = { ...f.overrides };
      if (mode) overrides[key] = mode; else delete overrides[key];
      return { ...f, overrides };
    });

  const page = pageKey && (FRAME_PAGE_TEMPLATES as readonly string[]).includes(pageKey)
    ? pageKey as FramePageTemplate : null;
  const pageOverride = page ? frame.overrides[page] : undefined;
  const effective = frameModeFor(frame, page);
  const modeLabel = (m: FrameMode) => t(`layoutEditor.frame.mode.${m}`);
  const pageLabel = (p: FramePageTemplate) => t(`layoutEditor.template.${p}`);
  const overrideCount = Object.keys(frame.overrides).length;
  // Every control below the tiles is about a box; with no box anywhere they do nothing.
  const allFull = frame.mode === "full" && Object.values(frame.overrides).every((m) => m === "full");
  const bg = frame.background;
  const swatch = frameBackgroundCss(bg, bg.type === "image" && bg.image ? resolveImageSource(bg.image) : undefined);
  const images = [...new Set([...(bg.image ? [bg.image] : []), ...library])];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      let last = "";
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        // The stored PATH, never the URL — the theme exporter reads the path off disk.
        const res = await api.post<{ path: string }>("/admin/layouts/images", fd);
        last = res.path;
        setLibrary((l) => [...l, res.path]);
      }
      if (last) setBg({ image: last });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const seg = <T extends string>(value: T, current: T, label: string, onPick: (v: T) => void) => (
    <button key={value} type="button" className={current === value ? "is-on" : ""} onClick={() => onPick(value)}>
      {label}
    </button>
  );

  const themeFrame = query.data?.theme ?? null;
  const themeName = query.data?.themeName ?? null;

  return (
    <div className="lay-frame" ref={rootRef}>
      <button type="button"
        className={`lay-frame__trigger${open ? " is-open" : ""}`}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <FontAwesomeIcon icon={faWindowRestore} />
        <span>{t("layoutEditor.frame.title")}</span>
        <span className="lay-frame__trigger-mode">
          {pageOverride
            ? t("layoutEditor.frame.modeOnPage", { mode: modeLabel(effective), page: pageLabel(page!) })
            : modeLabel(effective)}
        </span>
        <FontAwesomeIcon icon={faChevronDown} className="lay-frame__caret" />
      </button>

      {open && (
        <div className="lay-frame__panel" role="dialog" aria-label={t("layoutEditor.frame.title")}>
          <div className="lay-frame__head">
            <span className="lay-frame__head-icon"><FontAwesomeIcon icon={faWindowRestore} /></span>
            <span className="lay-frame__head-text">
              <b>{t("layoutEditor.frame.title")}</b>
              <code>site.frame · {t("layoutEditor.frame.everyPage")}</code>
            </span>
            <span className="lay-frame__chip">{t("layoutEditor.frame.siteWide")}</span>
            <button type="button" className="lay-frame__close" aria-label={t("layoutEditor.cancel")}
              onClick={() => setOpen(false)}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="lay-frame__body">
            {/* ── Frame ─────────────────────────────────────────────── */}
            <section className="lay-frame__sec">
              <div className="lay-frame__sec-title">{t("layoutEditor.frame.frame")}</div>
              <div className="lay-frame__tiles">
                {FRAME_MODES.map((m) => (
                  <button key={m} type="button"
                    className={`lay-frame__tile${frame.mode === m ? " is-on" : ""}`}
                    aria-pressed={frame.mode === m}
                    onClick={() => set({ mode: m })}>
                    <span className={`lay-frame__mini lay-frame__mini--${m}`} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <span className="lay-frame__tile-label">{modeLabel(m)}</span>
                  </button>
                ))}
              </div>
              <p className="lay-frame__hint">{t(`layoutEditor.frame.hint.${frame.mode}`)}</p>
              {page && pageOverride && (
                <div className="lay-frame__notice">
                  <span>{t("layoutEditor.frame.pageOverride", { page: pageLabel(page), mode: modeLabel(pageOverride) })}</span>
                  <Button variant="ghost" onClick={() => setOverride(page, "")}>
                    {t("layoutEditor.frame.useDefault")}
                  </Button>
                </div>
              )}
            </section>

            {/* ── Box ───────────────────────────────────────────────── */}
            {/* In every mode, full width included: the space around the content. */}
            <section className="lay-frame__sec">
              <div className="lay-frame__sec-title">{t("layoutEditor.frame.content")}</div>
              <Range label={t("layoutEditor.frame.contentWidth")} value={frame.contentWidth} unit="px"
                {...FRAME_LIMITS.contentWidth} onChange={(v) => set({ contentWidth: v })} />
              <Range label={t("layoutEditor.frame.readingWidth")} value={frame.readingWidth} unit="px"
                {...FRAME_LIMITS.readingWidth} onChange={(v) => set({ readingWidth: v })} />
              <p className="lay-frame__hint">{t("layoutEditor.frame.contentHint")}</p>
            </section>

            <section className={`lay-frame__sec${allFull ? " is-dim" : ""}`}>
              <div className="lay-frame__sec-title">{t("layoutEditor.frame.box")}</div>
              <Range label={t("layoutEditor.frame.maxWidth")} value={frame.maxWidth} unit="px"
                {...FRAME_LIMITS.maxWidth} onChange={(v) => set({ maxWidth: v })} />
              <Range label={t("layoutEditor.frame.radius")} value={frame.radius} unit="px"
                {...FRAME_LIMITS.radius} onChange={(v) => set({ radius: v })} />
              {(effective === "overlap" || frame.mode === "overlap") && (
                <Range label={t("layoutEditor.frame.overlap")} value={frame.overlap} unit="px"
                  {...FRAME_LIMITS.overlap} onChange={(v) => set({ overlap: v })} />
              )}
              <div className="lay-frame__row">
                <span>{t("layoutEditor.frame.shadow")}</span>
                <div className="lay__seg">
                  {seg("none", frame.shadow, t("layoutEditor.frame.shadowNone"), (v) => set({ shadow: v }))}
                  {seg("soft", frame.shadow, t("layoutEditor.frame.shadowSoft"), (v) => set({ shadow: v }))}
                  {seg("lifted", frame.shadow, t("layoutEditor.frame.shadowLifted"), (v) => set({ shadow: v }))}
                </div>
              </div>
            </section>

            {/* ── Body background ───────────────────────────────────── */}
            <section className={`lay-frame__sec${allFull ? " is-dim" : ""}`}>
              <div className="lay-frame__row">
                <div className="lay-frame__sec-title">{t("layoutEditor.frame.background")}</div>
                <div className="lay__seg">
                  {seg("color", bg.type, t("layoutEditor.frame.bgColor"), (v) => setBg({ type: v }))}
                  {seg("gradient", bg.type, t("layoutEditor.frame.bgGradient"), (v) => setBg({ type: v }))}
                  {seg("image", bg.type, t("layoutEditor.frame.bgImage"), (v) => setBg({ type: v }))}
                </div>
              </div>
              <div className="lay-frame__swatch" style={{ backgroundImage: swatch }} />

              {bg.type === "color" && (
                <ColorRow value={bg.color} onChange={(v) => setBg({ color: v })} />
              )}

              {bg.type === "gradient" && (
                <>
                  <div className="lay-frame__row lay-frame__row--sub">
                    <span>{t("layoutEditor.frame.colours")}</span>
                    <span className="lay-frame__muted">{t("layoutEditor.frame.stopCount", { n: bg.stops.length })}</span>
                  </div>
                  {bg.stops.map((c, i) => (
                    <ColorRow key={i} value={c}
                      onChange={(v) => setBg({ stops: bg.stops.map((s, j) => (j === i ? v : s)) })}
                      onRemove={bg.stops.length > 2 ? () => setBg({ stops: bg.stops.filter((_, j) => j !== i) }) : undefined}
                      removeLabel={t("layoutEditor.frame.removeStop")} />
                  ))}
                  {bg.stops.length < 3 && (
                    <Button variant="ghost" className="lay-frame__add"
                      onClick={() => setBg({ stops: [...bg.stops, THIRD_STOP] })}>
                      <FontAwesomeIcon icon={faPlus} /> {t("layoutEditor.frame.addStop")}
                    </Button>
                  )}
                  <div className="lay-frame__dir">
                    <div className="lay-frame__compass">
                      {COMPASS.map((d, i) => {
                        const on = "radial" in d ? bg.radial : !bg.radial && bg.angle === d.angle;
                        return (
                          <button key={i} type="button" className={on ? "is-on" : ""}
                            title={"radial" in d ? t("layoutEditor.frame.radial") : `${d.angle}°`}
                            onClick={() => setBg("radial" in d ? { radial: true } : { radial: false, angle: d.angle })}>
                            {"radial" in d
                              ? <FontAwesomeIcon icon={faCircleDot} />
                              : <FontAwesomeIcon icon={faArrowUp} style={{ transform: `rotate(${d.angle}deg)` }} />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="lay-frame__dir-side">
                      <Range label={t("layoutEditor.frame.direction")} value={bg.angle}
                        display={bg.radial ? t("layoutEditor.frame.radialShort") : `${bg.angle}°`}
                        {...FRAME_LIMITS.angle} dim={bg.radial}
                        onChange={(v) => setBg({ angle: v, radial: false })} />
                      <p className="lay-frame__hint">
                        {t(bg.radial ? "layoutEditor.frame.radialHint" : "layoutEditor.frame.directionHint")}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {bg.type === "image" && (
                <>
                  <div className="lay-frame__row lay-frame__row--sub">
                    <span>{t("layoutEditor.frame.chooseImage")}</span>
                  </div>
                  <div className="lay-frame__library">
                    <button type="button" className="lay-frame__upload" disabled={uploading}
                      onClick={() => fileRef.current?.click()}>
                      <FontAwesomeIcon icon={faUpload} />
                      {uploading ? t("layoutEditor.bgUploading") : t("layoutEditor.bgUpload")}
                    </button>
                    {images.map((path) => (
                      <button key={path} type="button" title={path}
                        className={`lay-frame__thumb${bg.image === path ? " is-on" : ""}`}
                        style={{ backgroundImage: `url("${resolveImageSource(path)}")` }}
                        onClick={() => setBg({ image: path })} />
                    ))}
                  </div>
                  <input ref={fileRef} type="file" hidden multiple
                    accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
                    onChange={(e) => void upload(e.target.files)} />
                  <p className="lay-frame__hint">
                    {t(bg.image ? "layoutEditor.frame.imageSet" : "layoutEditor.frame.imageNone")}
                  </p>
                </>
              )}

              <label className="lay-frame__check">
                <Toggle on={bg.fixed} onToggle={() => setBg({ fixed: !bg.fixed })} />
                <span>
                  <span>{t("layoutEditor.frame.fixed")}</span>
                  <span className="lay-frame__muted">{t("layoutEditor.frame.fixedHint")}</span>
                </span>
              </label>
            </section>

            {/* ── Navbar & phones ───────────────────────────────────── */}
            <section className="lay-frame__sec">
              <div className="lay-frame__sec-title">{t("layoutEditor.frame.phones")}</div>
              {/* Stickiness is the NAVBAR block's setting — one switch, where the navbar is. */}
              <p className="lay-frame__hint">{t("layoutEditor.frame.stickyMoved")}</p>
              <div className={`lay-frame__row${allFull ? " is-dim" : ""}`}>
                <span>{t("layoutEditor.frame.phone")}</span>
                <div className="lay__seg">
                  {seg("edge", frame.phone, t("layoutEditor.frame.phoneEdge"), (v) => set({ phone: v }))}
                  {seg("keep", frame.phone, t("layoutEditor.frame.phoneKeep"), (v) => set({ phone: v }))}
                </div>
              </div>
            </section>

            {/* ── Per page ──────────────────────────────────────────── */}
            <section className="lay-frame__sec">
              <div className="lay-frame__row">
                <div className="lay-frame__sec-title">{t("layoutEditor.frame.perPage")}</div>
                <span className="lay-frame__muted">
                  {overrideCount
                    ? t("layoutEditor.frame.overrideCount", { count: overrideCount })
                    : t("layoutEditor.frame.allDefault")}
                </span>
              </div>
              <p className="lay-frame__hint">{t("layoutEditor.frame.perPageHint")}</p>
              {FRAME_PAGE_TEMPLATES.map((p) => {
                const v = frame.overrides[p] ?? "";
                return (
                  <div key={p} className="lay-frame__page">
                    <span>
                      <b>{pageLabel(p)}</b>
                      <code>{PAGE_ROUTES[p]}</code>
                    </span>
                    <select className={`acp-input${v ? " is-set" : ""}`} value={v}
                      aria-label={pageLabel(p)}
                      onChange={(e) => setOverride(p, e.target.value as FrameMode | "")}>
                      <option value="">{t("layoutEditor.frame.siteDefault")}</option>
                      {FRAME_MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
                    </select>
                  </div>
                );
              })}
            </section>
          </div>

          <div className="lay-frame__foot">
            <span>
              {themeName && themeFrame
                ? t("layoutEditor.frame.shipsWith", { name: `${themeName.name} ${themeName.version}`.trim() })
                : t("layoutEditor.frame.noThemeFrame")}
              <br />
              <span className="lay-frame__muted">{t("layoutEditor.frame.draftNote")}</span>
            </span>
            <Button variant="ghost" disabled={revert.isPending}
              onClick={() => revert.mutate()}>
              <FontAwesomeIcon icon={faRotateLeft} />{" "}
              {t(themeFrame ? "layoutEditor.frame.revertTheme" : "layoutEditor.frame.resetDefault")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Range({
  label, value, unit = "", display, min, max, step, dim, onChange,
}: {
  label: string; value: number; unit?: string; display?: string;
  min: number; max: number; step: number; dim?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`lay-frame__range${dim ? " is-dim" : ""}`}>
      <div className="lay-frame__row">
        <span>{label}</span>
        <code>{display ?? `${value}${unit}`}</code>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/**
 * A colour as a swatch plus text. The text is the truth: a stop may be
 * `var(--c-accent)`, which a picker cannot show — and the schema refuses anything
 * that is not a colour, so a half-typed value is held here until it parses.
 */
export function ColorRow({
  value, onChange, onRemove, removeLabel,
}: { value: string; onChange: (v: string) => void; onRemove?: () => void; removeLabel?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (v: string) => {
    setText(v);
    if (/^(#[0-9a-fA-F]{3,8}|rgba?\(.+\)|hsla?\(.+\)|var\(--[a-zA-Z0-9_-]+\))$/.test(v.trim())) onChange(v.trim());
  };
  return (
    <div className="lay-frame__color">
      <ColorInput value={isHex(value) ? value : "#000000"} onChange={(v) => commit(v)} />
      <input className="acp-input" value={text} onChange={(e) => commit(e.target.value)} />
      {onRemove && (
        <button type="button" className="lay-frame__x" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}
    </div>
  );
}
