import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NotificationBell } from "../../../components/NotificationBell";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { ACP_NAV_INDEX as NAV_INDEX } from "../useAcpNav";
import { AcpSearch } from "./AcpSearch";

/**
 * The rail chrome's one horizontal line: where you are on the left, the alert
 * surfaces on the right.
 *
 * The redesign folds the whole top bar into the sidebar, and this is what did
 * not fit. The notification bell and every `registerHeaderWidget` a plugin
 * contributes are 40px buttons whose menus are ~340px wide and open downward,
 * pinned to the button's right edge. That works against the right edge of a
 * full-width strip and nowhere else: inside the 72px rail or the 248px panel
 * the menu would start several hundred pixels off the left of the screen. A
 * plugin cannot be asked to know which chrome it is being drawn in, so the
 * chrome keeps a place where its assumptions hold.
 *
 * It carries no navigation — that is the rail's and the panel's job — so it is
 * 44px against the old chrome's 140px.
 */
export function AcpUtilityBar({ showSearch }: {
  /** True when the panel is collapsed and has nowhere to put the palette.
   *  Exactly one AcpSearch may be mounted at a time — two would both answer ⌘K. */
  showSearch: boolean;
}) {
  const { t } = useTranslation("acp");
  const { pathname } = useLocation();

  // Breadcrumb from the matched nav entry (longest matching `to`).
  const match = NAV_INDEX
    .filter((n) => pathname === n.to || (n.to !== "/admin" && pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const crumbKeys = ["topbar.breadcrumbRoot", match?.subKey, match?.labelKey].filter(Boolean) as string[];

  return (
    <div className="acp-util">
      <nav className="acp-crumbs" aria-label={t("topbar.breadcrumb")}>
        {crumbKeys.map((key, i) => (
          <span key={key} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbKeys.length - 1 ? <b>{t(key)}</b> : <span>{t(key)}</span>}
          </span>
        ))}
      </nav>

      <div className="acp-util__right">
        {showSearch && <AcpSearch />}
        {slotRegistry.getHeaderWidgets().map((w) => (
          <w.component key={w.id} />
        ))}
        <NotificationBell />
      </div>
    </div>
  );
}
