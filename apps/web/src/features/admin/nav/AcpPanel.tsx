import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AcpIcon, navIcon } from "../pages/acpIcons";
import { childMatches, type NavItem } from "../useAcpNav";
import { AcpSearch } from "./AcpSearch";
import { setAcpCollapsed } from "./acpChrome";

/**
 * The 248px section panel: the pages of ONE section, never a tree of all of
 * them. Which section it shows is the rail's business — this only draws it.
 *
 * The same component is the docked column and the collapsed-mode flyout; only
 * the wrapper's positioning differs, which is why `variant` changes nothing but
 * the class and the collapse button's meaning.
 *
 * ⚠ It deliberately does NOT nest a page's own sub-sections (System Settings
 * has eight). Every ACP page owns its secnav — see the shared set-secnav shell
 * — and mirroring one page's sections up here would give an admin two lists
 * that must agree, driven by two pieces of state.
 */
export function AcpPanel({ section, variant = "docked", canDock = true, showSearch = true, onNavigate }: {
  section: NavItem | undefined;
  variant?: "docked" | "flyout";
  /** False below the docking width: the flyout is the only panel there is. */
  canDock?: boolean;
  /** ⚠ Exactly one AcpSearch may be mounted — every instance answers ⌘K, so two
   *  of them open two palettes. A flyout only exists while the panel is
   *  collapsed, and the utility bar owns the field then, so the flyout passes
   *  false. */
  showSearch?: boolean;
  /** Called after a page link is followed, so the flyout can close itself. */
  onNavigate?: () => void;
}) {
  const { t } = useTranslation("acp");
  const { pathname } = useLocation();

  return (
    <div className={`acp-panel acp-panel--${variant}`}>
      <div className="acp-panel__head">
        <div className="acp-panel__brand">
          <div className="acp-panel__name">xentium</div>
          <div className="acp-panel__tag">{t("sidebar.adminPanel")}</div>
        </div>
        {variant === "docked" ? (
          <button
            type="button"
            className="acp-panel__collapse"
            title={t("sidebar.collapsePanel")}
            aria-label={t("sidebar.collapsePanel")}
            onClick={() => setAcpCollapsed(true)}
          >
            <AcpIcon name="chevronsLeft" size={13} />
          </button>
        ) : canDock ? (
          <button
            type="button"
            className="acp-panel__collapse"
            title={t("sidebar.dockPanel")}
            aria-label={t("sidebar.dockPanel")}
            onClick={() => { setAcpCollapsed(false); onNavigate?.(); }}
          >
            <AcpIcon name="chevronsRight" size={13} />
          </button>
        ) : null}
      </div>

      {showSearch && (
        <div className="acp-panel__search">
          <AcpSearch align="left" compact />
        </div>
      )}

      {section && (
        <>
          <div className="acp-panel__section">
            <span className="acp-panel__sectionic">{navIcon(section, true)}</span>
            <span>{t(section.label)}</span>
          </div>

          <nav className="acp-panel__nav acp-scroll">
            {/* A leaf section (Dashboard) has one destination and
                it is the section itself — listing it again would be the same
                word twice, so the rail cell is the whole control. */}
            {(section.children ?? []).map((child, i, all) => {
              const active = childMatches(child, pathname);
              // A section may group its pages (System: Setup / Logs): a small heading
              // where the group changes.
              const heading = child.group && child.group !== all[i - 1]?.group ? child.group : null;
              return (
                <Fragment key={child.to}>
                {heading && <span className="acp-panel__group">{t(heading)}</span>}
                <Link
                  to={child.to}
                  className={`acp-panel__item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {t(child.label)}
                </Link>
                </Fragment>
              );
            })}
          </nav>
        </>
      )}

      <div className="acp-panel__foot">
        <Link to="/" className="acp-panel__site">
          <AcpIcon name="external" size={15} />
          <span>{t("topbar.viewSite")}</span>
        </Link>
      </div>
    </div>
  );
}
