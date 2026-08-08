import { useTranslation } from "react-i18next";

/**
 * The ACP's autosave indicator, as used in the `pg-head` of settings-style
 * pages. Shared so every autosaving admin page reports state identically —
 * `.savechip` styling lives in acpSystem.scss.
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
