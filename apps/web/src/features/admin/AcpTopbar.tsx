import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../hooks/useTheme";
import { AcpIcon } from "./pages/acpIcons";
// Breadcrumb routes come from the one nav definition — see ACP_NAV_INDEX.
import { ACP_NAV_INDEX as NAV_INDEX } from "./useAcpNav";
import { AcpSearch } from "./nav/AcpSearch";
import { AcpUserMenu } from "./nav/AcpUserMenu";
import "./AcpTopbar.scss";

// The horizontal chrome's top line: breadcrumb + palette on the left, the util
// cluster on the right. The palette and the user menu are shared with the rail
// chrome (nav/) — this file is only their arrangement.
//
// No notification bell and no plugin header widgets. Notifications and private
// messages are things that happen to you as a MEMBER, and the place to read
// them is the site; the ACP is a tool for running the place, and every unread
// count in here was a reason to leave the job you came in to do. Plugins keep
// their `registerHeaderWidget` slot — it still renders in the site's own
// chrome (layout/blocks/chromeBlocks.tsx).

// ── Topbar ─────────────────────────────────────────────────────────────────────
export function AcpTopbar() {
  const { t } = useTranslation("acp");
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  // Breadcrumb from the matched nav entry (longest matching `to`).
  const match = NAV_INDEX
    .filter((n) => pathname === n.to || (n.to !== "/admin" && pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const crumbKeys = ["topbar.breadcrumbRoot", match?.subKey, match?.labelKey].filter(Boolean) as string[];

  return (
    <header className="acp-topbar acp-topbar--nav">
      <div className="nbtop__left">
        <nav className="acp-crumbs" aria-label={t("topbar.breadcrumb")}>
          {crumbKeys.map((key, i) => (
            <span key={key} style={{ display: "contents" }}>
              {i > 0 && <span className="sep">/</span>}
              {i === crumbKeys.length - 1 ? <b>{t(key)}</b> : <span>{t(key)}</span>}
            </span>
          ))}
        </nav>
        <AcpSearch />
      </div>

      <div className="nbtop__right">
        <Link to="/" className="nbghost">
          <AcpIcon name="external" size={15} />
          <span>{t("topbar.viewSite")}</span>
        </Link>
        <span className="nbdiv" />
        <button
          type="button"
          className="nbiconbtn"
          title={t("topbar.toggleTheme")}
          aria-label={t("topbar.toggleTheme")}
          onClick={toggle}
        >
          <AcpIcon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
        <span className="nbdiv" />
        <AcpUserMenu />
      </div>
    </header>
  );
}
