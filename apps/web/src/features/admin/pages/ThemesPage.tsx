/**
 * Appearance → Themes.
 *
 * The live theme on top — what visitors see now, its colour variants, the way into
 * Theme Studio and the way back (one level of undo). The library underneath: every
 * theme installed here plus Core, each drawn in its own colours, each with its own
 * edits, any of them one click from live.
 *
 * Switching is LIVE and never loses anything: every theme keeps its own layouts and
 * colours, so switching only changes which one visitors see. Undo puts back the theme
 * — and the colours — that were live before.
 */
import { useRef, useState, type CSSProperties } from "react";
import { blocksThisSiteCannotDraw } from "../../../layout/themeFootprint";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faDownload, faRotateLeft, faTrash as faTrashIcon, faTriangleExclamation, faUpload } from "@fortawesome/free-solid-svg-icons";
import { Link } from "react-router-dom";
import { CORE_THEME_PARAM } from "../../../lib/editingTheme";
import { api, apiStream } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { timeAgo } from "../../../lib/time";
import { openThemeExportDialog } from "./ThemeExportDialog";
import { studioHref } from "./studioLinks";
import { openDialog } from "../../../lib/dialog";
import { offerThemeSwitch } from "../hooks/themeSwitchPrompt";
import { AcpIcon } from "./acpIcons";
import "./ThemesPage.scss";
import { siteTime } from "../../../lib/datetime";
import { Button } from "../../../components/AcpControls";

interface Palette { bg: string; surface: string; accent: string; accent2: string; fg: string }
interface Colourway { id: string; name: string; accent: string; accent2: string }

/** What `/admin/themes/overview` says about one theme (Core included). */
interface Summary {
  key: string;
  palette: Palette;
  colourways: Colourway[];
  wornColourway: string | null;
  editedAt: string | null;
}
interface LibraryTheme extends Summary {
  id: string; name: string; version: string; vendor: string;
  active: boolean;
  installedAt: string;
}
interface Overview {
  core: Summary;
  themes: LibraryTheme[];
  rollback: { available: boolean; replaced: string | null; at: string | null; update: boolean };
}

/** A theme as this page draws it, Core and installed alike. */
interface Card extends Summary {
  /** The id the API takes: `_core` for Core. */
  id: string;
  name: string;
  version: string;
  vendor: string | null;
  installedAt: string | null;
  live: boolean;
  isCore: boolean;
}

interface ImportReport {
  manifest: { id: string; name: string };
  activated: boolean;
  current: { id: string; name: string } | null;
  templates: string[];
  kept: string[];
  unknownBlocks: string[];
  unknownTemplates: string[];
  assetsImported: number;
  customCssApplied: boolean;
  ignoredFiles: string[];
}

const OVERVIEW = ["acp-theme-overview"] as const;

/** A theme's palette with one of its colourways laid over it. */
const withColourway = (p: Palette, cw: Colourway | undefined): Palette =>
  cw ? { ...p, accent: cw.accent, accent2: cw.accent2 } : p;

const swatchesOf = (p: Palette) => [p.bg, p.surface, p.accent, p.accent2, p.fg];

export function ThemesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const undrawable = report ? blocksThisSiteCannotDraw(report.unknownBlocks) : [];
  const [exporting, setExporting] = useState(false);
  /** The colourway picked on each card (and previewed on the live one) — not live yet. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data } = useQuery<Overview>({ queryKey: OVERVIEW, queryFn: () => api.get("/admin/themes/overview") });

  /** Everything a theme change touches. */
  function invalidateTheme() {
    for (const key of ["acp-theme-overview", "acp-theme-installed", "acp-theme-library", "acp-layout",
                       "acp-layout-status", "acp-layout-templates", "acp-layout-all",
                       "acp-layout-frame", "acp-tokens", "acp-draft-status"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }

  const cards: Card[] = data ? [
    {
      ...data.core, id: CORE_THEME_PARAM, name: t("themeScope.core"), version: "", vendor: null,
      installedAt: null, live: !data.themes.some((x) => x.active), isCore: true,
    },
    ...data.themes.map((th) => ({ ...th, installedAt: th.installedAt, live: th.active, isCore: false })),
  ] : [];
  const live = cards.find((c) => c.live);
  const library = cards.filter((c) => !c.live);

  const labelOf = (c: Card, cwId: string | null | undefined) => {
    const cw = c.colourways.find((x) => x.id === cwId);
    return cw ? `${c.name} · ${cw.name}` : c.name;
  };

  // ── Actions ──────────────────────────────────────────────────────────────

  const undoMut = useMutation({
    mutationFn: () => api.post<{ restored: boolean; replaced: string | null }>("/admin/themes/discard", {}),
    onSuccess: (res) => {
      if (res.replaced) toast.success(t("themes.backTo", { name: res.replaced }));
      setReport(null);
      setPicked({});
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  async function undo() {
    // Undoing an UPDATE puts the old package's layouts back, which can lose edits made
    // since; undoing a switch or a colourway loses nothing, so it just happens.
    if (data?.rollback.update) {
      const ok = await openDialog({
        kind: "confirm", icon: "warning", danger: true,
        title: t("themes.discardTitle"), body: t("themes.discardBody"), confirmText: t("themes.discardBtn"),
      });
      if (!ok) return;
    }
    undoMut.mutate();
  }

  /** "X is now live", with the undo right there. */
  const announce = (name: string) => toast.success(t("themes.nowLive", { name }), {
    action: { label: t("themes.discardBtn"), onClick: () => undoMut.mutate() },
  });

  const activateMut = useMutation({
    mutationFn: ({ card, colourway }: { card: Card; colourway?: string }) => api.post(
      card.isCore ? "/admin/themes/core/activate" : `/admin/themes/library/${card.id}/activate`,
      colourway ? { colourway } : {},
    ),
    onSuccess: (_r, { card, colourway }) => {
      announce(labelOf(card, colourway ?? card.wornColourway));
      setPicked((p) => { const { [card.id]: _gone, ...rest } = p; return rest; });
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const colourwayMut = useMutation({
    mutationFn: (colourway: string) => api.post("/admin/themes/colourway", { colourway }),
    onSuccess: (_r, colourway) => {
      if (live) announce(labelOf(live, colourway));
      setPicked((p) => { const { [live?.id ?? ""]: _gone, ...rest } = p; return rest; });
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/themes/library/${id}`),
    onSuccess: (_r, id) => {
      toast.success(t("themes.removedNamed", { name: cards.find((c) => c.id === id)?.name ?? id }));
      setConfirming(null);
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const importMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<ImportReport>("/admin/themes/import", fd);
    },
    onSuccess: async (res) => {
      setReport(res);
      invalidateTheme();
      // Installing is not switching — ask.
      const switched = await offerThemeSwitch(t, {
        id: res.manifest.id, name: res.manifest.name, activated: res.activated, current: res.current,
      });
      if (switched && !res.activated) {
        setReport(null);
        invalidateTheme();
      }
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function runExport() {
    const meta = await openThemeExportDialog(t);
    if (!meta) return;
    setExporting(true);
    try {
      const { tokensOnly, screenshot, appearance, ...fields } = meta;
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v.trim() !== "") body.append(k, v);
      body.append("appearance", appearance);
      if (tokensOnly) body.append("tokensOnly", "true");
      if (screenshot) body.append("screenshot", screenshot);
      const res = await apiStream("/admin/themes/export", body);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? t("themes.exportFailed"));
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meta.id}-${meta.version}.xttheme`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("themes.exportedNamed", { file: `${meta.id}-${meta.version}.xttheme` }));
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const fmtDate = (iso: string | null) => (iso ? siteTime.date(iso) : "");
  const edited = (c: Card) => (c.editedAt ? timeAgo(c.editedAt) : t("themes.never"));
  const busy = activateMut.isPending || colourwayMut.isPending || undoMut.isPending;

  // ── The live theme ───────────────────────────────────────────────────────

  const heroPick = live ? picked[live.id] ?? live.wornColourway ?? undefined : undefined;
  const heroPalette = live ? withColourway(live.palette, live.colourways.find((c) => c.id === heroPick)) : null;
  const previewing = !!live && !!heroPick && heroPick !== live.wornColourway;
  const pickedCw = live?.colourways.find((c) => c.id === heroPick);
  const wornCw = live?.colourways.find((c) => c.id === live.wornColourway);

  return (
    <div className="thm">
      <header className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.appearance")}</p>
          <h1 className="pg-title">{t("themes.title")}</h1>
          <p className="pg-sub">{t("themes.subtitle")}</p>
        </div>
        <div className="thm__head-actions">
          <Button variant="ghost" disabled={importMut.isPending} onClick={() => fileRef.current?.click()}>
            <FontAwesomeIcon icon={faUpload} /> {importMut.isPending ? t("themes.importing") : t("themes.installBtn")}
          </Button>
          <Button variant="ghost" disabled={exporting} onClick={() => void runExport()}>
            <FontAwesomeIcon icon={faDownload} /> {exporting ? t("themes.exporting") : t("themes.exportBtn")}
          </Button>
          {/* `.xtstyle` is accepted too — a theme with no layouts. */}
          <input ref={fileRef} type="file" accept=".xttheme,.xtstyle,.zip" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importMut.mutate(f); e.target.value = ""; }} />
        </div>
      </header>

      {report && <ImportReportCard report={report} undrawable={undrawable} onClose={() => setReport(null)} />}

      {live && heroPalette && (
        <section className="thm-live">
          <div className="thm-live__shot"><ThemeMock palette={heroPalette} size="lg" /></div>
          <div className="thm-live__info">
            <span className="thm-live__badge"><i />{t("themes.liveOnSite")}</span>
            <div className="thm-live__name">
              <h2>{live.name}</h2>
              {live.version && <span>{live.version}</span>}
            </div>
            <p className="thm-live__by">{live.isCore ? t("themes.coreBylineLong") : t("themes.installedBy", { vendor: live.vendor || "—" })}</p>

            <dl className="thm-live__facts">
              <dt>{t("themes.factInstalled")}</dt><dd>{live.isCore ? t("themes.builtIn") : fmtDate(live.installedAt)}</dd>
              <dt>{t("themes.factEdited")}</dt><dd>{edited(live)}</dd>
              <dt>{t("themes.factPalette")}</dt>
              <dd className="thm-swatches">{swatchesOf(heroPalette).map((c, i) => <i key={i} title={c} style={{ background: c }} />)}</dd>
            </dl>

            {live.colourways.length > 0 && (
              <div className="thm-live__variants">
                <div className="thm-live__variants-head">
                  <span>{t("themes.variant")}</span>
                  <span>{t("themes.variantCount", { count: live.colourways.length })}</span>
                </div>
                <div className="thm-chips" role="radiogroup" aria-label={t("themes.variant")}>
                  {live.colourways.map((cw) => (
                    <button key={cw.id} type="button" role="radio" aria-checked={cw.id === heroPick}
                      className={`thm-chip${cw.id === heroPick ? " is-on" : ""}`}
                      onClick={() => setPicked((p) => ({ ...p, [live.id]: cw.id }))}>
                      <i style={{ background: cw.accent }} />
                      <span>{cw.name}</span>
                      {cw.id === live.wornColourway && <b>{t("themes.liveTag")}</b>}
                    </button>
                  ))}
                </div>
                {previewing && pickedCw && (
                  <div className="thm-live__preview">
                    <span>{t("themes.previewing", { name: pickedCw.name, live: wornCw?.name ?? live.name })}</span>
                    <div>
                      <Button disabled={busy}
                        onClick={() => colourwayMut.mutate(pickedCw.id)}>
                        {t("themes.makeNamedLive", { name: pickedCw.name })}
                      </Button>
                      <Button variant="ghost"
                        onClick={() => setPicked((p) => { const { [live.id]: _gone, ...rest } = p; return rest; })}>
                        {t("themes.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="thm-live__actions">
              {/* The plain route: the theme is already live, so this is what visitors get. */}
              <a className="btn-primary" href="/" target="_blank" rel="noreferrer">
                <AcpIcon name="external" size={16} /> {t("themes.previewLive")}
              </a>
              <Link className="btn-ghost" to={studioHref(live.id)}>
                <AcpIcon name="palette" size={16} /> {t("themes.editStudio")}
              </Link>
              {data?.rollback.available && (
                <Button variant="ghost" disabled={busy} onClick={() => void undo()}>
                  <FontAwesomeIcon icon={faRotateLeft} /> {undoMut.isPending ? t("themes.discarding") : t("themes.undoSwitch")}
                </Button>
              )}
            </div>
            {data?.rollback.available && data.rollback.replaced && (
              <p className="thm-live__note">{t("themes.undoNote", { name: data.rollback.replaced })}</p>
            )}
          </div>
        </section>
      )}

      {/* ── The library ─────────────────────────────────────────────────────── */}
      <section className="thm-lib">
        <div className="thm-lib__head">
          <h2>{t("themes.library")}</h2>
          <span className="thm-lib__count">{cards.length}</span>
          <span className="thm-lib__hint">{t("themes.libraryHintShort")}</span>
          <Link className="thm-lib__market" to="/admin/marketplace?kind=theme">
            {t("themes.browseMarket")} <AcpIcon name="arrowRight" size={14} />
          </Link>
        </div>

        <div className="thm-grid">
          {library.map((c) => {
            const sel = picked[c.id] ?? c.wornColourway ?? c.colourways[0]?.id;
            const cw = c.colourways.find((x) => x.id === sel);
            const palette = withColourway(c.palette, cw);
            return (
              <article key={c.id} className="thm-card">
                <div className="thm-card__shot"><ThemeMock palette={palette} size="sm" /></div>
                <div className="thm-card__body">
                  <div className="thm-card__top">
                    <div className="thm-card__titles">
                      <p className="thm-card__name"><b>{c.name}</b>{c.version && <span>{c.version}</span>}</p>
                      <p className="thm-card__by">{c.isCore ? t("themes.coreByline") : t("themes.installedBy", { vendor: c.vendor || "—" })}</p>
                    </div>
                    <span className="thm-swatches thm-swatches--stack">
                      {swatchesOf(palette).map((s, i) => <i key={i} style={{ background: s }} />)}
                    </span>
                  </div>

                  {c.colourways.length > 0 && (
                    <div className="thm-card__variants">
                      {c.colourways.map((v) => (
                        <button key={v.id} type="button" title={v.name} aria-label={v.name} aria-pressed={v.id === sel}
                          className={`thm-dot${v.id === sel ? " is-on" : ""}`} style={{ background: v.accent }}
                          onClick={() => setPicked((p) => ({ ...p, [c.id]: v.id }))} />
                      ))}
                      <span>{t("themes.variantsOf", { name: cw?.name ?? "", count: c.colourways.length })}</span>
                    </div>
                  )}

                  <p className="thm-card__dates">
                    {c.isCore
                      ? t("themes.datesCore", { edited: edited(c) })
                      : t("themes.dates", { installed: fmtDate(c.installedAt), edited: edited(c) })}
                  </p>

                  <div className="thm-card__actions">
                    <Button disabled={busy}
                      onClick={() => activateMut.mutate({ card: c, colourway: cw && cw.id !== c.wornColourway ? cw.id : undefined })}>
                      {t("themes.makeLive")}
                    </Button>
                    <Link className="btn-ghost btn-sm" to={studioHref(c.id)} title={t("themes.editStudio")}>{t("themes.edit")}</Link>
                    {!c.isCore && (
                      <button type="button" className="thm-card__remove" title={t("themes.remove")}
                        aria-label={t("themes.removeNamed", { name: c.name })} onClick={() => setConfirming(c.id)}>
                        <FontAwesomeIcon icon={faTrashIcon} />
                      </button>
                    )}
                  </div>
                </div>

                {confirming === c.id && (
                  <div className="thm-card__confirm" role="alertdialog" aria-label={t("themes.removeAsk", { name: c.name })}>
                    <p><b>{t("themes.removeAsk", { name: c.name })}</b></p>
                    <p>{t("themes.removeAskBody")}</p>
                    <div>
                      <Button variant="danger" disabled={removeMut.isPending}
                        onClick={() => removeMut.mutate(c.id)}>{t("themes.remove")}</Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>{t("themes.cancel")}</Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * A theme drawn as a little site in its own colours — header, hero and three cards.
 * The colours are the theme's DATA (from its tokens), which is why they are inline.
 */
function ThemeMock({ palette: p, size }: { palette: Palette; size: "lg" | "sm" }) {
  const v = {
    "--m-bg": p.bg, "--m-surface": p.surface, "--m-accent": p.accent, "--m-accent2": p.accent2, "--m-fg": p.fg,
  } as CSSProperties;
  return (
    <div className={`thm-mock thm-mock--${size}`} style={v} aria-hidden="true">
      <div className="thm-mock__nav"><i /><b /><b /><b /><span /></div>
      <div className="thm-mock__hero"><b /><b /><span /></div>
      <div className="thm-mock__cards">
        {[0, 1, 2].map((i) => <div key={i}><b /><b /><b /></div>)}
      </div>
    </div>
  );
}

function ImportReportCard({ report, undrawable, onClose }: { report: ImportReport; undrawable: string[]; onClose: () => void }) {
  const { t } = useTranslation("acp");
  return (
    <div className="thm__report">
      <div className="thm__report-head">
        <b>{t("themes.reportTitle")}</b>
        <button type="button" className="thm__report-close" aria-label={t("themes.cancel")} onClick={onClose}>
          <AcpIcon name="x" size={16} />
        </button>
      </div>
      <ul>
        <li>{report.activated
          ? t("themes.reportTemplates", { count: report.templates.length })
          : t("themes.reportInLibrary", { name: report.manifest.name })}</li>
        {report.kept.length > 0 && <li>{t("themes.reportKept", { count: report.kept.length })}</li>}
        {report.assetsImported > 0 && <li>{t("themes.reportAssets", { count: report.assetsImported })}</li>}
        {report.customCssApplied && (
          <li className="thm__warn"><FontAwesomeIcon icon={faTriangleExclamation} /> {t("themes.reportCustomCss")}</li>
        )}
        {report.ignoredFiles.length > 0 && (
          <li className="thm__warn"><FontAwesomeIcon icon={faTriangleExclamation} /> {t("themes.ignoredFiles")} {report.ignoredFiles.join(", ")}</li>
        )}
        {report.unknownTemplates.length > 0 && (
          <li className="thm__warn"><FontAwesomeIcon icon={faTriangleExclamation} /> {t("themes.reportUnknownTemplates", { list: report.unknownTemplates.join(", ") })}</li>
        )}
        {/* Filtered: the API cannot see plugin blocks, which the browser registers. */}
        {undrawable.length > 0 && (
          <li className="thm__warn"><FontAwesomeIcon icon={faTriangleExclamation} /> {t("themes.reportUnknownBlocks", { list: undrawable.join(", ") })}</li>
        )}
      </ul>
    </div>
  );
}
