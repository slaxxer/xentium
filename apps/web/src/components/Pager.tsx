import { FontAwesomeIcon } from "./Icon";
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
  if (totalPages <= 1) return null;
  return (
    <div className="acp-pagination" style={{ padding: "12px 20px", borderTop: "1px solid var(--c-border)", marginTop: 0, ...style }}>
      <button className="btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page === 1}>
        <FontAwesomeIcon icon={faChevronLeft} />
      </button>
      <span>{label}</span>
      <button className="btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
    </div>
  );
}
