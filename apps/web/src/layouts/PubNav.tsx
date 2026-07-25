import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSun,
  faMoon,
  faGear,
  faChevronDown,
  faUser,
  faRightFromBracket,
  faArrowUpRightFromSquare,
  faMagnifyingGlass,
  faCircleNodes,
} from "@fortawesome/free-solid-svg-icons";
import { NotificationBell } from "../components/NotificationBell";
import { AcpStatusBadge } from "../components/AcpStatusBadge";
import { slotRegistry } from "../plugins/slotRegistry";
import { Username } from "../components/Username";
import { Avatar } from "../components/Avatar";
import { topGroups } from "../lib/groupBadge";
// UserAvatar replaced by the Hearth Avatar throughout the nav
import { useTheme } from "../hooks/useTheme";
import { useAuth, applyLogout } from "../hooks/useAuth";
import { useRegistrationStatus } from "../hooks/useRegistrationStatus";
import { api } from "../lib/api";

interface NavItem {
  id: string;
  label: string;
  url: string;
  isSystem: boolean;
  openInNewTab: boolean;
  visibility: string; // "public" | "members" | "groups"
  placement?: string; // "navbar" | "footer"
}

/** Core system routes get a localized label; everything else (custom links and
 *  plugin-registered nav items) uses its DB label. Core does not localize plugin
 *  routes — plugins ship their own label via registerNavItem / their translations. */
const SYSTEM_NAV_I18N: Record<string, string> = {
  "/":         "nav.home",
  "/articles": "nav.articles",
  "/members":  "nav.members",
};

function useNavItems(isAuthenticated: boolean) {
  const { data = [] } = useQuery<NavItem[]>({
    queryKey: ["pub-nav-items"],
    queryFn: () => api.get("/nav-items"),
    staleTime: 60_000,
  });
  return data.filter(item =>
    item.placement !== "footer" &&
    (item.visibility === "public" ||
      (item.visibility === "members" && isAuthenticated)),
  );
}

function useBranding() {
  return useQuery<{ navbarUrl: string | null; iconUrl: string | null; logoText: string | null }>({
    queryKey: ["pub-branding"],
    queryFn:  () => api.get("/appearance/branding"),
    staleTime: 300_000, // 5 min — branding rarely changes
  });
}

/** Show ACP tab for administrators and moderators. */
function hasAcpAccess(groups: Array<{ key: string }>) {
  return groups.some((g) => g.key === "admin" || g.key === "supermod" || g.key === "moderator");
}

function UserDropdown({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Self badge in the nav respects the user's badge-visibility choice.
  const primaryGroup = topGroups(user.visibleGroups, (g) => g.displayOrder, 1)[0];

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    applyLogout();
  }

  return (
    <div className="pub-nav__user-menu" ref={menuRef}>
      <button
        className="pub-nav__avatar-btn"
        type="button"
        aria-label={t("nav.openProfileMenu")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar user={{ username: user.username, avatar: user.avatar }} size={36} online />
        <FontAwesomeIcon icon={faChevronDown} className="pub-nav__avatar-caret" />
      </button>

      {open && (
        <div className="pub-nav__dropdown">
          <div className="pub-nav__dropdown-header">
            <Avatar user={{ username: user.username, avatar: user.avatar }} size={44} />
            <div>
              <div className="pub-nav__dropdown-name">
                <Username username={user.username} badgeColor={primaryGroup?.badgeColor} />
              </div>
              {primaryGroup && (() => {
                const color = primaryGroup.badgeColor ?? "var(--c-accent)";
                return (
                  <span
                    className="pub-nav__dropdown-group"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "1px 7px", borderRadius: 20,
                      fontSize: 11, fontWeight: 700,
                      background: `${color}20`, color, border: `1px solid ${color}40`,
                    }}
                  >
                    {primaryGroup.badgeLabel ?? primaryGroup.name}
                  </span>
                );
              })()}
            </div>
          </div>

          <div className="pub-nav__dropdown-divider" />

          <Link
            to={`/u/${user.username}`}
            className="pub-nav__dropdown-item"
            onClick={() => setOpen(false)}
          >
            <FontAwesomeIcon icon={faUser} />
            {t("nav.myProfile")}
          </Link>
          <Link
            to="/account"
            className="pub-nav__dropdown-item"
            onClick={() => setOpen(false)}
          >
            <FontAwesomeIcon icon={faGear} />
            {t("nav.accountSettings")}
          </Link>

          <div className="pub-nav__dropdown-divider" />

          <button
            className="pub-nav__dropdown-item pub-nav__dropdown-item--danger"
            onClick={handleLogout}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

function NavSearch() {
  const { t } = useTranslation("common");
  const [value,   setValue]   = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const navigate  = useNavigate();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q.length >= 2) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
      inputRef.current?.blur();
    }
  }, [value, navigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") inputRef.current?.blur();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form className={`nav-search${focused ? " nav-search--open" : ""}`} onSubmit={handleSubmit}>
      <FontAwesomeIcon icon={faMagnifyingGlass} className="nav-search__icon" />
      <input
        ref={inputRef}
        className="nav-search__input"
        type="search"
        placeholder={focused ? t("search.full") : t("search.short")}
        value={value}
        onChange={e => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={t("nav.search")}
      />
      {focused && <kbd className="nav-search__hint">↵</kbd>}
    </form>
  );
}

export function PubNav() {
  const { t } = useTranslation("common");
  const { theme, toggle } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const { open: registrationOpen, betaMode } = useRegistrationStatus();
  const navItems             = useNavItems(isAuthenticated);
  const { data: branding }   = useBranding();

  const canAdmin = isAuthenticated && user ? hasAcpAccess(user.groups) : false;

  return (
    <nav className="pub-nav">
      <div className="pub-nav__inner">
        {/* Logo — image if set, otherwise logoText or default wordmark */}
        <NavLink to="/" className="pub-nav__logo">
          {branding?.navbarUrl ? (
            <img
              src={branding.navbarUrl}
              alt={branding.logoText ?? "Home"}
              style={{ height: 32, maxWidth: 160, objectFit: "contain", display: "block" }}
            />
          ) : (
            <>
              <span className="pub-nav__logomark" aria-hidden><FontAwesomeIcon icon={faCircleNodes} /></span>
              <span className="pub-nav__wordmark">{branding?.logoText || "nodevo"}</span>
            </>
          )}
        </NavLink>

        {/* Primary nav links — driven by nav_items table */}
        <ul className="pub-nav__links">
          {navItems.map(item => {
            const isExternal = item.url.startsWith("http");
            // System links get a localized label by route; custom links keep their DB label.
            const navLabel = SYSTEM_NAV_I18N[item.url]
              ? t(SYSTEM_NAV_I18N[item.url]!)
              : item.label;
            return (
              <li key={item.id}>
                {isExternal || item.openInNewTab ? (
                  <a
                    href={item.url}
                    target={item.openInNewTab ? "_blank" : undefined}
                    rel={item.openInNewTab ? "noopener noreferrer" : undefined}
                    className="pub-nav__external-link"
                  >
                    {navLabel}
                    {item.openInNewTab && (
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginLeft: 4, fontSize: 10 }} />
                    )}
                  </a>
                ) : (
                  <NavLink to={item.url}>{navLabel}</NavLink>
                )}
              </li>
            );
          })}
        </ul>

        <span className="pub-nav__spacer" />

        {/* Right-side actions */}
        <div className="pub-nav__actions">
          <NavSearch />
          {/* Theme toggle */}
          <button
            className="pub-nav__icon-btn"
            onClick={toggle}
            aria-label={t("nav.toggleTheme")}
            title={theme === "dark" ? t("nav.switchToLight") : t("nav.switchToDark")}
          >
            <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
          </button>

          {isAuthenticated && user ? (
            <>
              {/* Plugin header widgets (e.g. messaging) — rendered left of the bell */}
              {slotRegistry.getHeaderWidgets().map((w) => (
                <w.component key={w.id} />
              ))}

              {/* Notification bell */}
              <NotificationBell />

              {/* Admin panel — only visible to admins; badge flags pending
                  plugin updates / an expiring license waiting in the ACP */}
              {canAdmin && (
                <NavLink
                  to="/admin"
                  className="pub-nav__icon-btn pub-nav__icon-btn--acp"
                  aria-label={t("nav.adminPanel")}
                  title={t("nav.adminPanel")}
                >
                  <FontAwesomeIcon icon={faGear} />
                  <AcpStatusBadge />
                </NavLink>
              )}

              {/* Profile avatar + dropdown */}
              <UserDropdown user={user} />
            </>
          ) : (
            <>
              {registrationOpen && !betaMode && (
                <NavLink to="/register" className="pub-nav__register-btn">
                  {t("nav.register")}
                </NavLink>
              )}
              <NavLink to="/login" className="pub-nav__login-btn">
                {t("nav.signIn")}
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
