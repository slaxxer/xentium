import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ACP_NAV_INDEX as NAV_INDEX } from "../useAcpNav";
import { AcpSearch } from "./AcpSearch";

/**
 * The rail chrome's one horizontal line: where you are, and — when the panel is
 * collapsed — the palette.
 *
 * It held the notification bell and plugin header widgets until those were
 * taken out of the ACP entirely, so what is left is deliberately thin. It earns
 * its 44px in collapsed mode, where the panel is gone and this is the only
 * thing on screen that names the section you are in. Docked, it repeats what
 * the panel already says; that is the price of the chrome not moving around
 * when you collapse it.
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
      </div>
    </div>
  );
}
