import { useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import "./AcpLayout.scss";
import "./nav/AcpNav.scss";
import { AcpTopbar } from "./AcpTopbar";
import { useAcpNav, type NavItem } from "./useAcpNav";
import { HorizontalNav } from "./nav/HorizontalNav";
import { IconRail } from "./nav/IconRail";
import { AcpTweaksPanel } from "./AcpTweaksPanel";
import { useAcpTweaks, useApplyTweaks } from "./useAcpTweaks";

function Sidebar({ nav }: { nav: NavItem[] }) {
  const { t } = useTranslation("acp");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggle(key: string) {
    setExpanded((p) => ({ ...p, [key]: !p[key] }));
  }

  return (
    <div className="acp-sidebar">
      {/* Logo */}
      <div className="acp-sidebar__brand">
        <div className="acp-sidebar__logo-icon">
          <div className="acp-sidebar__logo-inner" />
        </div>
        <div>
          <div className="acp-sidebar__logo-name">nodevo</div>
          <div className="acp-sidebar__logo-sub">{t("sidebar.adminPanel")}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="acp-nav">
        {nav.map((item) => {
          if (item.to) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) => `acp-nav__item${isActive ? " acp-nav__item--active" : ""}`}
              >
                <span className="acp-nav__emoji">{item.icon}</span>
                {t(item.label)}
              </NavLink>
            );
          }

          return (
            <div key={item.key} className="acp-nav__section">
              <button type="button" className="acp-nav__section-btn" onClick={() => toggle(item.key!)}>
                <span className="acp-nav__emoji">{item.icon}</span>
                <span>{t(item.label)}</span>
                <span className="acp-nav__arrow" style={{ transform: expanded[item.key!] ? "rotate(180deg)" : "none" }}>▾</span>
              </button>
              {(expanded[item.key!] ?? false) && (
                <div className="acp-nav__children">
                  {item.children!.map((child) => (
                    <Link key={child.to} to={child.to} className="acp-nav__child">
                      <span>{t(child.label)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="acp-sidebar__footer">
        <Link to="/" className="acp-sidebar__back-btn">← {t("sidebar.backToSite")}</Link>
      </div>
    </div>
  );
}

function AcpAuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("acp");
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="acp-loading">{t("sidebar.loading")}</div>;
  }

  const hasAdminAccess = user?.groups?.some((g) => g.key === "admin");

  if (!user || !hasAdminAccess) {
    return (
      <div className="acp-forbidden">
        <h2>{t("sidebar.accessDeniedTitle")}</h2>
        <p>{t("sidebar.accessDeniedBody")}</p>
        <button type="button" className="btn-primary" onClick={() => navigate("/")}>
          {t("sidebar.goToSite")}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

function AcpShell() {
  const [tweaks, setTweak] = useAcpTweaks();
  const rootRef = useRef<HTMLDivElement>(null);
  useApplyTweaks(rootRef, tweaks);
  const nav = useAcpNav();

  const layout = tweaks.navLayout;

  return (
    <div className="acp-layout" data-layout={layout} ref={rootRef}>
      {layout === "sidebar" && <Sidebar nav={nav} />}
      {layout === "rail" && <IconRail nav={nav} />}

      <div className="acp-main">
        <AcpTopbar />
        {layout === "horizontal" && <HorizontalNav nav={nav} />}
        <main className="acp-content">
          <Outlet />
        </main>
      </div>

      <AcpTweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}

export function AcpLayout() {
  return (
    <AcpAuthGate>
      <AcpShell />
    </AcpAuthGate>
  );
}
