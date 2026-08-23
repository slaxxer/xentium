import { useTranslation } from "react-i18next";
// The `.savechip` rules live in the ACP stylesheet. Imported HERE rather than
// relied on: this component is rendered from plugin bundles too, which cannot
// import core SCSS, and until now it only worked because some other module
// happened to pull the sheet into the app bundle first.
import "../features/admin/pages/acpSystem.scss";

/**
 * The ACP's autosave indicator — the ONE way an admin surface reports save
 * state, core pages and plugin panels alike. `AutosaveStatus` is an alias for
 * it, kept because that is the import path plugins already use.
 *
 * Translated, unlike the inline-styled duplicate it replaced: the ACP ships in
 * five languages and a status line that only speaks English is a hole in that.
 */
export function SaveChip({ saving }: { saving: boolean }) {
  const { t } = useTranslation("acp");
  return (
    <div className={`savechip ${saving ? "is-saving" : "is-saved"}`} aria-live="polite">
      {saving ? <span className="savechip__spin" /> : <span className="savechip__dot" />}
      <span>{saving ? t("settings.saving") : t("settings.saved")}</span>
    </div>
  );
}
