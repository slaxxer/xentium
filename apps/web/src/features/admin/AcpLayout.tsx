import { useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import "./AcpLayout.scss";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import { faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { slotRegistry } from "../../plugins/slotRegistry";
import { api } from "../../lib/api";
import { AcpTopbar } from "./AcpTopbar";
import { AcpIcon } from "./pages/acpIcons";

interface NavChild {
  label: string;
  to: string;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  to?: string;
  key?: string;
  children?: NavChild[];
}

// `label` values are `acp` i18n keys, resolved with t() at render. Plugin-registered
// sections supply literal labels — i18next returns the key as-is when it's not found,
// so those pass through untranslated, which is correct.
const NAV: NavItem[] = [
  { label: "nav.dashboard", icon: <AcpIcon name="dashboard" size={18} />, to: "/admin" },
  {
    label: "nav.users",
    icon: <AcpIcon name="user" size={18} />,
    key: "users",
    children: [
      { label: "nav.userList",      to: "/admin/users" },
      { label: "nav.groups",        to: "/admin/groups" },
      { label: "nav.profileFields", to: "/admin/profile-fields" },
    ],
  },
  {
    label: "nav.accessControl",
    icon: <AcpIcon name="layers" size={18} />,
    key: "access",
    children: [
      { label: "nav.permissions", to: "/admin/permissions" },
      { label: "nav.progression", to: "/admin/progression" },
    ],
  },
  {
    label: "nav.content",
    icon: <AcpIcon name="file" size={18} />,
    key: "content",
    children: [
      { label: "nav.articles",   to: "/admin/articles" },
      { label: "nav.categories", to: "/admin/categories" },
    ],
  },
  {
    label: "nav.moderation",
    icon: <AcpIcon name="shield" size={18} />,
    key: "moderation",
    children: [
      { label: "nav.reviewCases", to: "/admin/cases" },
      { label: "nav.modLog",      to: "/admin/modlog" },
      { label: "nav.modSettings", to: "/admin/modsettings" },
    ],
  },
  {
    label: "nav.appearance",
    icon: <AcpIcon name="palette" size={18} />,
    key: "appearance",
    children: [
      { label: "nav.styleEditor",  to: "/admin/style-editor" },
      { label: "nav.styles",       to: "/admin/styles" },
      { label: "nav.styleHistory", to: "/admin/style-history" },
      { label: "nav.navigation",   to: "/admin/navigation" },
      { label: "Guest Home",       to: "/admin/guest-home" },
    ],
  },
  {
    label: "nav.extensions",
    icon: <AcpIcon name="puzzle" size={18} />,
    key: "extensions",
    children: [
      { label: "nav.marketplace", to: "/admin/marketplace" },
      { label: "nav.installed",   to: "/admin/installed" },
      { label: "nav.upload",      to: "/admin/upload" },
      { label: "nav.license",     to: "/admin/license" },
    ],
  },
  {
    label: "nav.system",
    icon: <AcpIcon name="cog" size={18} />,
    key: "system",
    children: [
      { label: "nav.settings",         to: "/admin/settings"          },
      { label: "nav.scheduledTasks",   to: "/admin/scheduled-tasks"    },
      { label: "nav.errorReference",   to: "/admin/error-ref"          },
      { label: "nav.errorLog",         to: "/admin/error-log"          },
      { label: "nav.migrationHistory", to: "/admin/migration-history"  },
      { label: "nav.about",            to: "/admin/about"              },
    ],
  },
];


function Sidebar() {
  const { t } = useTranslation("acp");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    users: false,
    access: false,
    content: false,
    moderation: false,
    appearance: false,
    extensions: false,
    system: false,
  });

  const { data: pluginPages = [] } = useQuery<{ section: string; label: string; path: string; pluginId: string }[]>({
    queryKey: ["acp-registered-pages"],
    queryFn:  () => api.get("/admin/registered-pages"),
    staleTime: 60_000,
  });

  // Build plugin sections (one per declared section name).
  // Sections registered by known "content-area" plugins go between Content and Moderation.
  // All other plugin sections go after Moderation.
  const pluginSectionMap = pluginPages.reduce<Record<string, NavChild[]>>((acc, page) => {
    (acc[page.section] ??= []).push({ label: page.label, to: page.path });
    return acc;
  }, {});

  const toNavItem = (section: string, children: NavChild[]): NavItem => {
    const meta = slotRegistry.getPluginMetaBySectionName(section);
    return {
      label:    section,
      icon:     meta?.icon ? <FontAwesomeIcon icon={meta.icon as any} /> : <FontAwesomeIcon icon={faPuzzlePiece} />,
      key:      `plugin-${section.toLowerCase()}`,
      children,
    };
  };

  const contentAreaSections = Object.entries(pluginSectionMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition === "after-content")
    .map(([s, ch]) => toNavItem(s, ch));

  const otherPluginSections = Object.entries(pluginSectionMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition !== "after-content")
    .map(([s, ch]) => toNavItem(s, ch));

  // Forum (and similar) between Content and Moderation; other plugins after Moderation
  const contentIdx    = NAV.findIndex((n) => n.key === "content");
  const moderationIdx = NAV.findIndex((n) => n.key === "moderation");
  const orderedNav = [
    ...NAV.slice(0, contentIdx + 1),
    ...contentAreaSections,
    ...NAV.slice(contentIdx + 1, moderationIdx + 1),
    ...otherPluginSections,
    ...NAV.slice(moderationIdx + 1),
  ];

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
        {orderedNav.map((item) => {
          if (item.to) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) =>
                  `acp-nav__item${isActive ? " acp-nav__item--active" : ""}`
                }
              >
                <span className="acp-nav__emoji">{item.icon}</span>
                {t(item.label)}
              </NavLink>
            );
          }

          return (
            <div key={item.key} className="acp-nav__section">
              <button
                type="button"
                className="acp-nav__section-btn"
                onClick={() => toggle(item.key!)}
              >
                <span className="acp-nav__emoji">{item.icon}</span>
                <span>{t(item.label)}</span>
                <span
                  className="acp-nav__arrow"
                  style={{ transform: expanded[item.key!] ? "rotate(180deg)" : "none" }}
                >
                  ▾
                </span>
              </button>
              {(expanded[item.key!] ?? false) && (
                <div className="acp-nav__children">
                  {item.children!.map((child) => (
                    <Link
                      key={child.to}
                      to={child.to}
                      className="acp-nav__child"
                    >
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
        <Link to="/" className="acp-sidebar__back-btn">
          ← {t("sidebar.backToSite")}
        </Link>
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

export function AcpLayout() {

  return (
    <AcpAuthGate>
      <div className="acp-layout">
        <Sidebar />

        <div className="acp-main">
          {/* Topbar — redesigned command-palette navbar */}
          <AcpTopbar />

          <main className="acp-content">
            <Outlet />
          </main>
        </div>
      </div>
    </AcpAuthGate>
  );
}
