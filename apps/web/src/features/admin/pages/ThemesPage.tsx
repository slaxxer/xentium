/**
 * Appearance → Themes: install one, package one up.
 *
 * Both used to live inside a collapsed `<details>` in the Layout Editor, which was the
 * wrong home for two reasons. Exporting is a form; importing REPLACES the look of every
 * page at once and answers with a report — how many templates it applied, which of the
 * admin's own it kept, what it could not render — and a report is not a toast. It is the
 * thing you read after the most sweeping change the ACP offers, so it gets a page and it
 * stays on screen.
 *
 * The Layout Editor keeps only "Revert to theme", which is per-template and belongs
 * beside the template picker.
 */
import { useRef, useState } from "react";
import { blocksThisSiteCannotDraw } from "../../../layout/themeFootprint";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faUpload, faPalette, faTriangleExclamation, faEye, faRotateLeft, faCheck, faTrash } from "@fortawesome/free-solid-svg-icons";
import { api, apiStream } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { resolveImageSource } from "../../../layout/blocks/coreBlocks";
import { openThemeExportDialog } from "./ThemeExportDialog";
import { openDialog } from "../../../lib/dialog";
import "./ThemesPage.scss";

interface InstalledTheme {
  manifest: {
    id: string; name: string; version: string;
    vendor?: string; importedAt?: string;
    /** Where the package's preview image landed on THIS install — the importer
     *  rewrites the package-relative path to an upload path, so it renders. */
    screenshot?: string;
  } | null;
  /** Templates the theme layer holds — what "Revert to theme" can restore. */
  templates: string[];
  /** Whether the LAST import can still be walked back, and what it replaced. One
   *  level only: a second import overwrites the undo point, and publishing drops it. */
  rollback: { available: boolean; replaced: string | null; at: string | null };
}

/** One row of the library. The payload never leaves the server — this is what the
 *  ACP needs to draw a card and offer a switch. */
interface LibraryTheme {
  id: string; name: string; version: string; vendor: string;
  active: boolean;
  installedAt: string;
  activatedAt: string | null;
  screenshot: string | null;
}

interface ImportReport {
  templates: string[];
  kept: string[];
  unknownBlocks: string[];
  unknownTemplates: string[];
  assetsImported: number;
  customCssApplied: boolean;
}

export function ThemesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  // ⚠ NOT `report.unknownBlocks` as received. The API's known-block set is the CORE
  // catalogue — plugin blocks are registered in the browser, so the server cannot see
  // one and names every one of them, and this report was telling admins that blocks
  // rendering on their own site could not be rendered. See `blocksThisSiteCannotDraw`.
  const undrawable = report ? blocksThisSiteCannotDraw(report.unknownBlocks) : [];
  const [exporting, setExporting] = useState(false);

  /**
   * Undo the last import — the whole of it, in one action.
   *
   * Everything the import touched goes back: every layout scope it wrote —
   * `published` included, since applying a theme goes live — and both
   * appearance theme layers. The confirmation is not ceremony — the admin may have
   * edited a layout since importing, and those edits live in the same draft scope the
   * restore replaces, so this is genuinely lossy in a way the button alone cannot say.
   */
  const discardMut = useMutation({
    mutationFn: () => api.post<{ restored: boolean; replaced: string | null }>("/admin/themes/discard", {}),
    onSuccess: (res) => {
      toast.success(res.replaced
        ? t("themes.discardDoneReplaced", { name: res.replaced })
        : t("themes.discardDone"));
      setReport(null);
      // The same set an import invalidates — this is the same change, backwards.
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  async function confirmDiscard() {
    const ok = await openDialog({
      kind: "confirm",
      icon: "warning",
      danger: true,
      title: t("themes.discardTitle"),
      body:  t("themes.discardBody"),
      confirmText: t("themes.discardBtn"),
    });
    if (ok) discardMut.mutate();
  }

  /** Everything installed here — active first. Installed is not active. */
  const libraryQuery = useQuery<{ themes: LibraryTheme[] }>({
    queryKey: ["acp-theme-library"],
    queryFn:  () => api.get("/admin/themes/library"),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/themes/library/${id}/activate`, {}),
    onSuccess: (_r, id) => {
      const name = libraryQuery.data?.themes.find((t) => t.id === id)?.name ?? id;
      toast.success(t("themes.activated", { name }));
      invalidateTheme();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/themes/library/${id}`),
    onSuccess: () => { toast.success(t("themes.removed")); invalidateTheme(); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  /** Everything a theme change touches, in one place — three call sites had been
   *  keeping their own copies of this list. */
  function invalidateTheme() {
    for (const key of ["acp-theme-installed", "acp-theme-library", "acp-layout",
                       "acp-layout-status", "acp-layout-templates", "acp-tokens"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }

  const installedQuery = useQuery<InstalledTheme>({
    queryKey: ["acp-theme-installed"],
    queryFn:  () => api.get("/admin/themes/installed"),
  });
  const installed = installedQuery.data?.manifest ?? null;

  const importMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<ImportReport>("/admin/themes/import", fd);
    },
    onSuccess: (res) => {
      setReport(res);
      // Everything a theme touches: the layouts it wrote, what counts as customised,
      // the tokens under the Style Editor, and the installed-theme record itself.
      qc.invalidateQueries({ queryKey: ["acp-layout"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-templates"] });
      qc.invalidateQueries({ queryKey: ["acp-theme-installed"] });
      qc.invalidateQueries({ queryKey: ["acp-tokens"] });
    },
    // The message names the file and the rule it broke, so it is worth showing whole.
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function runExport() {
    const meta = await openThemeExportDialog(t);
    if (!meta) return;
    setExporting(true);
    try {
      const { tokensOnly, screenshot, ...fields } = meta;
      // Multipart, because the package may carry a preview image — and multipart
      // has no types, so `tokensOnly` goes as the string the server's schema
      // explicitly accepts rather than as a value JS truthiness would misread.
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        // Blank optionals are omitted rather than sent as "" — the API rejects an
        // empty string where it wants a URL.
        if (v.trim() !== "") body.append(k, v);
      }
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
      a.download = `${meta.id}-${meta.version}.nvtheme`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("themes.exported"));
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="thm">
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.appearance")}</div>
          <h1 className="acp-page-title">{t("themes.title")}</h1>
        </div>
        <button type="button" className="btn-ghost btn-sm"
          disabled={exporting} onClick={() => void runExport()}>
          <FontAwesomeIcon icon={faDownload} />{" "}
          {exporting ? t("themes.exporting") : t("themes.exportBtn")}
        </button>
      </div>

      <p className="thm__intro">{t("themes.intro")}</p>

      {/* ── What the site inherits from ─────────────────────────────────── */}
      <div className="acp-card thm__card">
        <div className="thm__card-title">{t("themes.installedTitle")}</div>
        {installed ? (
          <>
            <div className="thm__installed">
              {/* The theme's own picture when it shipped one, the generic glyph when
                  it did not. Resolved exactly as an image block resolves its source,
                  so a theme pointing at a CDN still works. */}
              {installed.screenshot
                ? <img className="thm__shot" src={resolveImageSource(installed.screenshot)} alt="" />
                : <FontAwesomeIcon icon={faPalette} />}
              <div>
                <b>{installed.name} {installed.version}</b>
                <span>
                  {t("themes.installedBy", { vendor: installed.vendor ?? "—" })}
                  {installed.importedAt
                    ? ` · ${t("themes.installedOn", { date: new Date(installed.importedAt).toLocaleDateString() })}`
                    : ""}
                </span>
              </div>
            </div>
            <p className="thm__note">{t("themes.installedNote")}</p>

            {/* ── Look at it, or take it back ──────────────────────────────
                Applying a theme is LIVE: every page takes its arrangement and
                colours the moment it is activated, visitors included. So the two
                things an admin needs afterwards are a way to LOOK at the result
                and a way OUT. Neither existed: the only preview was of the
                theme's own package, and nothing could undo an import. */}
            <div className="thm__actions">
              <a
                className="btn-primary btn-sm"
                // The plain route, no `__layout` flag. The theme is already published,
                // so this is the page visitors get; a draft preview here would show
                // the admin's own unpublished layout edits and call them the theme.
                href="/"
                target="_blank"
                rel="noreferrer"
              >
                <FontAwesomeIcon icon={faEye} /> {t("themes.previewLive")}
              </a>
              {installedQuery.data?.rollback?.available && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={discardMut.isPending}
                  onClick={() => void confirmDiscard()}
                >
                  <FontAwesomeIcon icon={faRotateLeft} />{" "}
                  {discardMut.isPending ? t("themes.discarding") : t("themes.discardBtn")}
                </button>
              )}
            </div>
            <p className="thm__note">
              {t("themes.previewHint")}
              {installedQuery.data?.rollback?.replaced
                ? ` ${t("themes.discardHintReplaced", { name: installedQuery.data.rollback.replaced })}`
                : installedQuery.data?.rollback?.available
                  ? ` ${t("themes.discardHintNone")}`
                  : ""}
            </p>
          </>
        ) : (
          <p className="thm__note">{t("themes.installedNone")}</p>
        )}
      </div>

      {/* ── The library ─────────────────────────────────────────────────────
          Installed is not active — the same distinction plugins draw. Until this
          existed, a single settings key held one manifest, so installing a second
          theme destroyed the first and an admin could not look at two and choose. */}
      {/* Shown as soon as anything is installed, not only at two: an admin needs to
          see that the library exists before they have a second theme in it. */}
      {(libraryQuery.data?.themes.length ?? 0) > 0 && (
        <div className="acp-card thm__card">
          <div className="thm__card-title">{t("themes.libraryTitle")}</div>
          <p className="thm__note">{t("themes.libraryHint")}</p>
          <div className="thm__library">
            {libraryQuery.data!.themes.map((th) => (
              <div key={th.id} className={`thm__lib${th.active ? " thm__lib--on" : ""}`}>
                {th.screenshot
                  ? <img className="thm__lib-shot" src={resolveImageSource(th.screenshot)} alt="" />
                  : <div className="thm__lib-shot thm__lib-shot--none"><FontAwesomeIcon icon={faPalette} /></div>}
                <div className="thm__lib-body">
                  <b>{th.name} {th.version}</b>
                  <span>{t("themes.installedBy", { vendor: th.vendor || "—" })}</span>
                </div>
                <div className="thm__lib-actions">
                  {th.active ? (
                    <span className="thm__lib-active">
                      <FontAwesomeIcon icon={faCheck} /> {t("themes.libraryActive")}
                    </span>
                  ) : (
                    <>
                      <button type="button" className="btn-primary btn-sm"
                        disabled={activateMut.isPending}
                        onClick={() => activateMut.mutate(th.id)}>
                        {t("themes.libraryActivate")}
                      </button>
                      {/* Only ever offered for a theme that is NOT active: removing
                          the active one would leave the site wearing something with
                          no baseline and no way back. The API refuses it too. */}
                      <button type="button" className="btn-ghost btn-sm"
                        disabled={removeMut.isPending}
                        onClick={() => removeMut.mutate(th.id)}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Install one ─────────────────────────────────────────────────── */}
      <div className="acp-card thm__card">
        <div className="thm__card-title">{t("themes.importTitle")}</div>
        <p className="thm__note">{t("themes.importHint")}</p>
        <button type="button" className="btn-primary btn-sm"
          disabled={importMut.isPending} onClick={() => fileRef.current?.click()}>
          <FontAwesomeIcon icon={faUpload} />{" "}
          {importMut.isPending ? t("themes.importing") : t("themes.importBtn")}
        </button>
        {/* `.nvstyle` is accepted too — it is a theme with no layouts (2026-08-15). */}
        <input ref={fileRef} type="file" accept=".nvtheme,.nvstyle,.zip" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importMut.mutate(f);
            e.target.value = "";   // so the same file can be picked twice
          }} />

        {report && (
          <div className="thm__report">
            <div className="thm__report-title">{t("themes.reportTitle")}</div>
            <ul>
              <li>{t("themes.reportTemplates", { count: report.templates.length })}</li>
              {/* The inheritance result, and the one line an admin must not have to
                  guess at: which of their own layouts an update left alone. */}
              {report.kept.length > 0 && <li>{t("themes.reportKept", { count: report.kept.length })}</li>}
              {report.assetsImported > 0 && <li>{t("themes.reportAssets", { count: report.assetsImported })}</li>}
              {report.customCssApplied && (
                <li className="thm__warn">
                  <FontAwesomeIcon icon={faTriangleExclamation} /> {t("themes.reportCustomCss")}
                </li>
              )}
              {report.unknownTemplates.length > 0 && (
                <li className="thm__warn">
                  <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                  {t("themes.reportUnknownTemplates", { list: report.unknownTemplates.join(", ") })}
                </li>
              )}
              {/* Not an error: the blocks stay in the document and reappear when the
                  plugin that provides them is enabled.
                  ⚠ FILTERED, not printed as received — the API's list names every
                  plugin block because it cannot see the browser's registry, so it
                  used to report blocks that were rendering on this very site. */}
              {undrawable.length > 0 && (
                <li className="thm__warn">
                  <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                  {t("themes.reportUnknownBlocks", { list: undrawable.join(", ") })}
                </li>
              )}
            </ul>
            <p className="thm__note">{t("themes.reportStaged")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
