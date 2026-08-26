import { useTranslation } from "react-i18next";
import { StyleHistoryList } from "../components/StyleHistoryList";

/**
 * ACP → Appearance → Style history.
 *
 * The list itself is shared with the Style Editor's History tab — a snapshot must
 * read the same in both places, and it used to be written twice.
 */
export function StyleHistoryPage() {
  const { t } = useTranslation("acp");
  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("styleHistory.sub")}</div>
          <h1 className="acp-page-title">{t("styleHistory.title")}</h1>
        </div>
      </div>
      <StyleHistoryList />
    </div>
  );
}
