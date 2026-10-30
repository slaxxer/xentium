import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../hooks/useTheme";
import { faUserShield } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { AcpIcon, navIcon } from "../pages/acpIcons";
import { type NavItem, navItemId } from "../useAcpNav";
import { AcpUserMenu } from "./AcpUserMenu";
import { AcpSearch } from "./AcpSearch";
import { setAcpCollapsed } from "./acpChrome";
import { sectionHasBadge, useAcpBadgeCounts } from "./acpBadges";

/**
 * The 72px icon rail: one cell per top-level section, always visible.
 *
 * It is the only nav chrome that never goes away, so it is also where the
 * always-available affordances live — expand (when the panel is collapsed),
 * the light/dark toggle, and the admin's own menu.
 *
 * Clicking a section does one of two things, and which one is the whole point
 * of the collapsed mode:
 *   docked    — navigates to the section's first page, and the panel beside it
 *               re-lists that section.
 *   collapsed — opens that section as a flyout WITHOUT navigating, so an admin
 *               can look into a section they are not in and change their mind.
 */
export function AcpRail({ nav, activeId, flyoutId, collapsed, canDock, onPeek }: {
  nav: NavItem[];
  /** Section the current route belongs to. */
  activeId: string | null;
  /** Section being previewed in the flyout, if any. */
  flyoutId: string | null;
  collapsed: boolean;
  /** False below the docking width, where expanding is not on offer. */
  canDock: boolean;
  onPeek: (id: string | null) => void;
}) {
  const { t } = useTranslation("acp");
  const counts = useAcpBadgeCounts();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const go = (item: NavItem) => {
    const to = item.to ?? item.children?.[0]?.to;
    if (to) navigate(to);
    onPeek(null);
  };

  return (
    <aside className="acp-rail" aria-label={t("sidebar.sections")}>
      {/* The staff mark, the same glyph the marketplace's ops console wears
          (Material's shield_person): this is the room only staff can enter. */}
      <div className="acp-rail__mark"><FontAwesomeIcon icon={faUserShield} /></div>

      {collapsed && canDock && (
        <button
          type="button"
          className="acp-rail__expand"
          title={t("sidebar.expandPanel")}
          aria-label={t("sidebar.expandPanel")}
          onClick={() => { setAcpCollapsed(false); onPeek(null); }}
        >
          <AcpIcon name="chevronsRight" size={13} />
        </button>
      )}

      <nav className="acp-rail__nav">
        {nav.map((item) => {
          const id = navItemId(item);
          // While a flyout is open it owns the highlight — otherwise the rail
          // would show two lit cells and neither would mean "you are here".
          const lit = flyoutId ? id === flyoutId : id === activeId;
          return (
            <button
              key={id}
              type="button"
              // `is-here` is the route, `is-active` is what is lit. They come
              // apart while peeking, and that is the point: the bar must stay
              // on the section you are actually in.
              className={`acp-rail__cell${lit ? " is-active" : ""}${id === activeId ? " is-here" : ""}`}
              title={t(item.label)}
              aria-label={t(item.label)}
              aria-current={id === activeId ? "page" : undefined}
              onClick={() => {
                // A leaf has nothing to preview, so it navigates either way.
                if (collapsed && item.children?.length) {
                  onPeek(flyoutId === id ? null : id);
                  return;
                }
                go(item);
              }}
            >
              <span className="acp-rail__bar" />
              {sectionHasBadge(item, counts) && <span className="acp-rail__dot" aria-hidden="true" />}
              {/* Outline at rest, filled when lit: the section you are in reads at a glance. */}
              {navIcon(item, lit)}
            </button>
          );
        })}
      </nav>

      <div className="acp-rail__spacer" />

      <div className="acp-rail__foot">
        {/* The palette follows the search field: in the panel when the panel is
            there, here when it is not. Never both — two would both answer ⌘K. */}
        {collapsed && <AcpSearch variant="rail" />}
        <button
          type="button"
          className="acp-rail__util"
          title={t("topbar.toggleTheme")}
          aria-label={t("topbar.toggleTheme")}
          onClick={toggle}
        >
          <AcpIcon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
        <span className="acp-rail__rule" />
        <AcpUserMenu variant="rail" />
      </div>
    </aside>
  );
}
