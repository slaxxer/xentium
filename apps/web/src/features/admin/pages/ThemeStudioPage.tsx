/**
 * Theme Studio — one theme's whole design in one place: its layouts, its colours and
 * type, the site branding, its custom CSS and its history.
 *
 * It used to be two pages, the Layout Editor and the Style Editor, each with its own
 * preview and its own Publish. They edit the same thing — one theme's draft — and two
 * Publish buttons let an admin put a redesigned page live without the colours it was
 * designed with. So there is ONE Publish here, and it always publishes both: the
 * theme's layout draft and its style draft together (`POST /admin/themes/studio/
 * publish`).
 *
 * The editors themselves are the existing ones, embedded: each drops its own header,
 * tabs and Publish. Once a mode has been opened it stays mounted (hidden), so going
 * from Layout to Colours and back keeps the layout's undo history, selection and
 * preview instead of starting over.
 *
 * The theme comes from `?theme=` (set by the Themes page), the mode from `?mode=`.
 */
import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { faArrowUpFromBracket, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import type { LayoutSelector } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { useEditingTheme, withTheme } from "../../../lib/editingTheme";
import { LayoutEditorPage } from "./LayoutEditorPage";
import { StyleEditorPage, type StyleTab } from "./StyleEditorPage";
import { STUDIO_MODES, type StudioMode } from "./studioLinks";
import { useEditingThemeRow } from "./ThemeStyle";
import "./acpSystem.scss";
import "./ThemeStudioPage.scss";
import { Button } from "../../../components/AcpControls";


/** Which Style Editor part each style mode shows. */
const STYLE_TAB: Record<Exclude<StudioMode, "layout">, StyleTab> = {
  style: "tokens", branding: "branding", css: "css", history: "history",
};

/**
 * The retired `/admin/layout-editor` and `/admin/style-editor` routes, redirected into
 * the Studio with their `?theme=` kept — and the Style Editor's `?tab=` mapped to the
 * matching mode — so bookmarks and the docs' old links land where they meant.
 */
export function StudioRedirect({ from }: { from: "layout" | "style" }) {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  p.delete("tab");
  const mode: StudioMode = from === "layout" ? "layout"
    : tab === "branding" ? "branding" : tab === "css" ? "css" : tab === "history" ? "history" : "style";
  if (mode !== "layout") p.set("mode", mode);
  const qs = p.toString();
  return <Navigate to={`/admin/theme-studio${qs ? `?${qs}` : ""}`} replace />;
}

interface StudioStatus { layouts: LayoutSelector[]; styleChanges: number; cssPending?: boolean; pending: boolean }

export function ThemeStudioPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { key } = useEditingTheme();
  const [params, setParams] = useSearchParams();
  const raw = params.get("mode");
  const mode: StudioMode = STUDIO_MODES.includes(raw as StudioMode) ? (raw as StudioMode) : "layout";

  // Each editor stays mounted once opened (the whole set remounts per theme, below,
  // via the key). The style editor remembers which of its four modes was last shown,
  // so it can stay mounted under the layout editor without changing tab.
  const [layoutOpened, setLayoutOpened] = useState(mode === "layout");
  const [styleTab, setStyleTab] = useState<StyleTab | null>(mode === "layout" ? null : STYLE_TAB[mode]);
  useEffect(() => {
    if (mode === "layout") setLayoutOpened(true);
    else setStyleTab(STYLE_TAB[mode]);
  }, [mode]);

  const pick = (next: StudioMode) => {
    const p = new URLSearchParams(params);
    if (next === "layout") p.delete("mode"); else p.set("mode", next);
    // Replace: switching modes is not navigation the back button should replay.
    setParams(p, { replace: true });
  };

  const { data: status } = useQuery<StudioStatus>({
    queryKey: ["studio-status", key],
    queryFn: () => api.get(withTheme("/admin/themes/studio/status", key)),
    // Both editors autosave in the background; this keeps the count honest.
    refetchInterval: 5_000,
  });

  const publish = useMutation({
    mutationFn: () => api.post<{ layouts: LayoutSelector[]; styles: boolean }>(
      withTheme("/admin/themes/studio/publish", key), {},
    ),
    onSuccess: async (res) => {
      await refreshTokenCss();
      // Everything either editor reads about drafts and live state.
      for (const k of ["studio-status", "acp-layout-status", "acp-layout-all", "acp-layout",
        "acp-draft-status", "studio-history", "acp-layout-frame"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      const n = res.layouts.length;
      toast.success(
        n || res.styles
          ? t("studio.published", { layouts: n, styles: res.styles ? t("studio.withStyles") : "" })
          : t("studio.nothingPending"),
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  /**
   * Bumped when the server replaced the draft wholesale (Reset theme). The editors read
   * the draft once when they mount and stay mounted while hidden, so a copy taken before
   * would linger, and its next autosave would write the old version straight back.
   * Remounting them is the one way to be sure nothing stale survives.
   */
  const [epoch, setEpoch] = useState(0);
  const { theme: editing, isCore } = useEditingThemeRow();

  const resetTheme = useMutation({
    mutationFn: () => api.post<StudioStatus>(withTheme("/admin/themes/studio/reset", key), {}),
    onSuccess: (next) => {
      qc.setQueryData(["studio-status", key], next);
      // Everything either editor reads about this theme's drafts, DROPPED rather than
      // invalidated: the editors remount below and seed themselves from the cache on
      // their first render, so a stale entry would hand them the old version again.
      for (const k of ["acp-layout-status", "acp-layout-all", "acp-layout", "acp-layout-templates",
        "acp-draft-status", "acp-tokens", "acp-layout-frame"]) {
        qc.removeQueries({ queryKey: [k] });
      }
      setEpoch((n) => n + 1);
      toast.success(next.pending ? t("studio.resetStaged") : t("studio.resetNothing"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function confirmResetTheme() {
    const name = isCore ? t("studio.coreName") : editing?.name ?? "";
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("studio.resetTitle", { theme: name }),
      body: isCore ? t("studio.resetBodyCore") : t("studio.resetBody", { theme: name }),
      confirmText: t("studio.resetConfirm"),
      cancelText: t("studio.resetCancel"),
    });
    if (ok) resetTheme.mutate();
  }

  const layouts = status?.layouts.length ?? 0;
  const styles = status?.styleChanges ?? 0;

  return (
    <div className="studio">
      <div className="pg-head studio__head">
        <div>
          <p className="pg-eyebrow">{t("nav.appearance")}</p>
          <h1 className="pg-title">{t("studio.title")}</h1>
        </div>

        <div className="studio__publish">
          {/* What goes live, in the two halves an admin thinks in. */}
          <span className={`studio__draft${status?.pending ? " is-pending" : ""}`}>
            <span className="studio__dot" aria-hidden="true" />
            {status?.pending
              ? t("studio.pending", {
                  layouts: t("studio.layoutChanges", { count: layouts }),
                  styles: t("studio.styleChanges", { count: styles })
                    + (status.cssPending ? ` · ${t("studio.cssStaged")}` : ""),
                })
              : t("studio.upToDate")}
          </span>
          <Button variant="ghost"
            disabled={resetTheme.isPending}
            title={t("studio.resetHint")}
            onClick={() => void confirmResetTheme()}>
            <FontAwesomeIcon icon={faRotateLeft} />
            {t("studio.reset")}
          </Button>
          <Button className="studio__go"
            disabled={publish.isPending || !status?.pending}
            title={t("studio.publishHint")}
            onClick={() => publish.mutate()}>
            <FontAwesomeIcon icon={faArrowUpFromBracket} />
            {publish.isPending ? t("studio.publishing") : t("studio.publish")}
          </Button>
        </div>
      </div>

      <div className="studio__modes" role="tablist" aria-label={t("studio.modes")}>
        {STUDIO_MODES.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m}
            className={mode === m ? "is-on" : ""} onClick={() => pick(m)}>
            {t(`studio.mode.${m}`)}
            {m === "layout" && layouts > 0 && <span className="studio__count">{layouts}</span>}
            {m === "style" && styles > 0 && <span className="studio__count">{styles}</span>}
            {m === "css" && status?.cssPending && <span className="studio__count" aria-label={t("studio.cssStaged")}>•</span>}
          </button>
        ))}
      </div>

      {/* Keyed by theme so switching themes remounts both editors; and by the reset
          epoch, so a reset does too. */}
      <div key={`${key ?? ""}:${epoch}`}>
        {(layoutOpened || mode === "layout") && (
          <div hidden={mode !== "layout"}><LayoutEditorPage /></div>
        )}
        {(styleTab || mode !== "layout") && (
          // ONE style editor for the four style modes: they are tabs of the same
          // component, sharing its draft and its preview state.
          <div hidden={mode === "layout"}>
            <StyleEditorPage tab={mode === "layout" ? styleTab! : STYLE_TAB[mode]} />
          </div>
        )}
      </div>
    </div>
  );
}
