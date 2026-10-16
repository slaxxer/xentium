/**
 * Theme Studio → History: ONE timeline per theme.
 *
 * Every Studio publish (the button or the schedule) is a revision holding everything
 * that went live together: layouts, colours, custom CSS, the font. Older colour-only
 * entries (a colourway applied from the Themes page, anything from before revisions)
 * sit in the same list by date.
 *
 * Restore never goes live by itself: it stages the entry as the theme's DRAFT, which
 * shows in the previews and goes out with the Studio's one Publish. It replaced the
 * Style Editor's own history list, whose restore wrote the colours live on the spot.
 */
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import type { LayoutSelector, UserRef } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Username } from "../../../components/Username";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { openDialog } from "../../../lib/dialog";
import { toast } from "../../../lib/toast";
import { withTheme } from "../../../lib/editingTheme";
import { uiLocale } from "../../../lib/i18n";
import "../pages/StyleEditorPage.scss";

interface HistoryEntry {
  id: string;
  kind: "revision" | "colours";
  label: string;
  createdAt: string;
  savedBy: UserRef | null;
  changes?: { layouts: LayoutSelector[]; tokens: number; css: boolean; font: boolean };
}

const when = (d: string) => new Date(d).toLocaleString(uiLocale(), {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

export function StudioHistory({ themeKey }: { themeKey: string | null }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { data: history = [], isLoading } = useQuery<HistoryEntry[]>({
    queryKey: ["studio-history", themeKey],
    queryFn: () => api.get(withTheme("/admin/themes/studio/history", themeKey)),
  });

  const stage = useMutation({
    mutationFn: (h: HistoryEntry) =>
      api.post(withTheme(`/admin/themes/studio/history/${h.kind}/${encodeURIComponent(h.id)}/stage`, themeKey), {}),
    onSuccess: () => {
      // Everything the editors read about the draft.
      for (const k of ["studio-status", "acp-tokens", "acp-draft-status", "acp-layout-status",
        "acp-layout-all", "acp-layout", "acp-layout-frame"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(t("studioHistory.staged"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const restore = async (h: HistoryEntry) => {
    const ok = await openDialog({
      kind: "confirm", icon: "question",
      title: t("studioHistory.confirmTitle", { when: when(h.createdAt) }),
      body: t(h.kind === "revision" ? "studioHistory.confirmRevision" : "studioHistory.confirmColours"),
      confirmText: t("studioHistory.restore"),
    });
    if (ok) stage.mutate(h);
  };

  /**
   * The entry's name. The server stores a few fixed English labels (the API is
   * locale-agnostic); those are shown in the reader's language, anything else as typed.
   */
  const labelFor = (h: HistoryEntry): string => {
    const raw = h.label.trim();
    if (!raw || raw === "Published appearance changes") {
      return t(h.kind === "revision" ? "studioHistory.published" : "studioHistory.colourChange");
    }
    if (raw === "Published theme changes (scheduled)") return t("studioHistory.scheduled");
    if (raw === "Undo colourway") return t("studioHistory.undoColourway");
    const cw = /^Colourway: (.+)$/.exec(raw);
    if (cw) return t("studioHistory.colourway", { name: cw[1] });
    const restored = /^Restored: (.+)$/.exec(raw);
    if (restored) return t("studioHistory.restored", { label: restored[1] });
    return raw;
  };

  /** What one entry changed, in the halves an admin thinks in. */
  const summary = (h: HistoryEntry): string => {
    if (h.kind === "colours") return t("studioHistory.coloursOnly");
    const c = h.changes;
    if (!c) return "";
    const parts: string[] = [];
    if (c.layouts.length) parts.push(t("studioHistory.layouts", { count: c.layouts.length }));
    if (c.tokens) parts.push(t("studioHistory.tokens", { count: c.tokens }));
    if (c.font) parts.push(t("studioHistory.font"));
    if (c.css) parts.push(t("studioHistory.css"));
    return parts.join(" · ");
  };

  if (isLoading) return <div className="acp-card acp-empty">{t("studioHistory.loading")}</div>;
  if (history.length === 0) return <div className="acp-card acp-empty">{t("studioHistory.empty")}</div>;

  return (
    <div className="se-hist">
      {history.map((h, i) => {
        const current = i === 0 && h.kind === "revision";
        return (
          <div key={`${h.kind}:${h.id}`} className="se-hist__row">
            <span className={`se-hist__dot${current ? " is-live" : ""}`} />
            <div className="se-hist__id">
              <div className="se-hist__t">{labelFor(h)}</div>
              <div className="se-hist__when">
                {when(h.createdAt)}
                {h.savedBy && <> · {t("studioHistory.by")}{" "}
                  <Username username={h.savedBy.username} badgeColor={h.savedBy.badgeColor} /></>}
              </div>
            </div>
            <div className="se-hist__sum">{summary(h)}</div>
            <span className={`se-hist__tag${current ? " is-live" : ""}`}>
              {current ? t("studioHistory.tagLive") : t(h.kind === "revision" ? "studioHistory.tagPublish" : "studioHistory.tagColours")}
            </span>
            <button type="button" className="btn-ghost btn-sm"
              disabled={stage.isPending || current}
              title={current ? t("studioHistory.liveHint") : t("studioHistory.restoreHint")}
              onClick={() => restore(h)}>
              <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight: 4 }} />
              {t("studioHistory.restore")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
