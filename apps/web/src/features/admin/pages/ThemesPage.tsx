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
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faUpload, faPalette, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api, apiStream } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { openThemeExportDialog } from "./ThemeExportDialog";
import "./ThemesPage.scss";

interface InstalledTheme {
  manifest: {
    id: string; name: string; version: string;
    vendor?: string; importedAt?: string;
  } | null;
  /** Templates the theme layer holds — what "Revert to theme" can restore. */
  templates: string[];
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
  const [exporting, setExporting] = useState(false);

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
      // Everything a theme touches: the layouts it staged, what counts as customised,
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
      const { tokensOnly, ...fields } = meta;
      const body = {
        // Blank optionals are omitted rather than sent as "" — the API rejects an
        // empty string where it wants a URL.
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== "")),
        ...(tokensOnly ? { tokensOnly: true } : {}),
      };
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
              <FontAwesomeIcon icon={faPalette} />
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
          </>
        ) : (
          <p className="thm__note">{t("themes.installedNone")}</p>
        )}
      </div>

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
                  plugin that provides them is enabled. */}
              {report.unknownBlocks.length > 0 && (
                <li className="thm__warn">
                  <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                  {t("themes.reportUnknownBlocks", { list: report.unknownBlocks.join(", ") })}
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
