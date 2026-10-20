import { useTranslation } from "react-i18next";
import { Button } from "./AcpControls";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import type { CSSProperties, ReactNode } from "react";

/** The one prev/label/next pagination bar for ACP list pages. Renders nothing
 *  when there is a single page. The caller owns the (localized) label. */
export function Pager({ page, totalPages, onPage, label, style }: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  label: ReactNode;
  style?: CSSProperties;
}) {
  const { t } = useTranslation("common");
  if (totalPages <= 1) return null;
  return (
    <div className="acp-pagination" style={{ padding: "12px 20px", borderTop: "1px solid var(--c-border)", marginTop: 0, ...style }}>
      <Button variant="ghost" icon={faChevronLeft} aria-label={t("actions.back")} onClick={() => onPage(page - 1)} disabled={page === 1} />
      <span>{label}</span>
      <Button variant="ghost" icon={faChevronRight} aria-label={t("actions.next")} onClick={() => onPage(page + 1)} disabled={page >= totalPages} />
    </div>
  );
}
