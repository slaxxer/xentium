import { useTranslation } from "react-i18next";
import { useDraftStore, useHasSaveBar } from "../hooks/useDraft";
// The `.savechip` rules live in the ACP stylesheet. Imported HERE rather than
// relied on: this component is rendered from plugin bundles too, which cannot
// import core SCSS, and until now it only worked because some other module
// happened to pull the sheet into the app bundle first.
import "../features/admin/pages/acpSystem.scss";

/**
 * The ACP's save status — the ONE way an admin page reports it, core pages and plugin
 * panels alike. `AutosaveStatus` is an alias, kept because plugins import it.
 *
 * In the ACP it speaks for the whole page's drafts (`useDraft`): all saved, N unsaved
 * changes, saving, or not saved. The `saving` prop is what shipped plugins pass; it is
 * only used where there is no save bar, or on a page that still autosaves a draft of
 * its own (`autosave` — Theme Studio, legal documents).
 */
export function SaveChip({ saving, autosave }: { saving: boolean; autosave?: boolean }) {
  const { t } = useTranslation("acp");
  const withBar = useHasSaveBar();
  const store = useDraftStore();

  if (autosave || !withBar) {
    return (
      <div className={`savechip ${saving ? "is-saving" : "is-saved"}`} aria-live="polite">
        {saving ? <span className="savechip__spin" /> : <span className="savechip__dot" />}
        <span>{saving ? t("settings.saving") : t("settings.saved")}</span>
      </div>
    );
  }

  const state = store.status === "saving" ? "saving"
    : store.status === "error" ? "error"
    : store.dirtyCount > 0 ? "dirty" : "clean";
  const text = state === "saving" ? t("settings.saving")
    : state === "error" ? t("savebar.chipError")
    : state === "dirty" ? t("savebar.unsaved", { count: store.dirtyCount })
    : t("settings.saved");
  return (
    <div className={`savechip is-${state}`} aria-live="polite">
      {state === "saving" ? <span className="savechip__spin" /> : <span className="savechip__dot" />}
      <span>{text}</span>
    </div>
  );
}
