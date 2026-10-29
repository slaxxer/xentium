import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { slotRegistry } from "../plugins/slotRegistry";
import {
  faGear,
  faChevronDown,
  faUser,
  faRightFromBracket,
  faArrowUpRightFromSquare,
  faMagnifyingGlass,
  faUserPlus,
  faBars,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { NotificationBell } from "../components/NotificationBell";
import { AcpStatusBadge } from "../components/AcpStatusBadge";
import { Username } from "../components/Username";
import { Avatar } from "../components/Avatar";
import { topGroups } from "../lib/groupBadge";
// UserAvatar replaced by the Hearth Avatar throughout the nav
import { useAuth, applyLogout } from "../hooks/useAuth";
import { userCan } from "../lib/authStore";
import { useRegistrationStatus } from "../hooks/useRegistrationStatus";
import { api } from "../lib/api";
import { LayoutRegion } from "../layout/LayoutRenderer";
import { useLayoutDocument } from "../layout/useLayout";
import { RankBadge } from "../components/RankBadge";
import { ModShield } from "../features/modcp/ModShield";
import { SignInMenu } from "../features/auth/doorway/SignInMenu";
import { useBranding } from "../hooks/useBranding";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { SiteLogo } from "../components/SiteLogo";
import { pluginNavLabel } from "../lib/coreText";

interface NavItem {
  id: string;
  label: string;
  url: string;
  isSystem: boolean;
  openInNewTab: boolean;
  visibility: string; // "public" | "members" | "groups"
  placement?: string; // "navbar" | "footer"
  /** Links in this item's dropdown (one level; ACP → Navigation or a plugin's registerNavItem). */
  children?: NavItem[];
}

const visibleTo = (isAuthenticated: boolean) => (item: NavItem) =>
  item.visibility === "public" || (item.visibility === "members" && isAuthenticated);

/** Core system routes get a localized label; a plugin's link translates through its
 *  `host.nav` text until an admin renames it; custom links use their DB label. */
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
  const can = visibleTo(isAuthenticated);
  return data
    .filter((item) => item.placement !== "footer" && can(item))
    .map((item) => ({ ...item, children: (item.children ?? []).filter(can) }));
}

/** The ACP entry, for whoever holds the key every ACP route requires. */
function hasAcpAccess(user: Parameters<typeof userCan>[0]) {
  return userCan(user, "admin.access");
}

/** Exported for its test; the header renders it. */
export function UserDropdown({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
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
        <Avatar user={{ username: user.username, avatar: user.avatar }} size={36} />
        {/* Shown in the masthead's action group only (CSS), as the composed header draws it. */}
        <Username className="pub-nav__avatar-name" username={user.username} badgeColor={primaryGroup?.badgeColor} />
        <FontAwesomeIcon icon={faChevronDown} className="pub-nav__avatar-caret" />
      </button>

      {open && (
        <div className="pub-nav__dropdown xt-pop">
          <div className="pub-nav__dropdown-header">
            <Avatar user={{ username: user.username, avatar: user.avatar }} size={44} />
            <div>
              <div className="pub-nav__dropdown-name">
                <Username username={user.username} badgeColor={primaryGroup?.badgeColor} />
              </div>
              {primaryGroup && (() => {
                const color = primaryGroup.badgeColor ?? "var(--c-accent)";
                return (
                  <RankBadge groupKey={primaryGroup.key} label={primaryGroup.badgeLabel ?? primaryGroup.name}><span
                    className="pub-nav__dropdown-group"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "1px 7px", borderRadius: 20,
                      fontSize: "var(--fs-2xs)", fontWeight: 700,
                      background: `${color}20`, color, border: `1px solid ${color}40`,
                    }}
                  >
                    {primaryGroup.badgeLabel ?? primaryGroup.name}
                  </span></RankBadge>
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
          {/* Plugin entries (Membership, …): plain links styled like core's own. */}
          {slotRegistry.getUserMenuItems().map((item) => (
            <Link key={item.id} to={item.to} className="pub-nav__dropdown-item" onClick={() => setOpen(false)}>
              {item.icon ? <FontAwesomeIcon icon={item.icon as IconDefinition} /> : null}
              {item.label}
            </Link>
          ))}

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

export function NavSearchBlock({ expanded = false }: { expanded?: boolean }) {
  return <NavSearch alwaysOpen={expanded} />;
}

function NavSearch({ alwaysOpen = false }: { alwaysOpen?: boolean }) {
  const { t } = useTranslation("common");
  const [value,   setValue]   = useState("");
  const [focused, setFocused] = useState(alwaysOpen);
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
        onBlur={() => setFocused(alwaysOpen)}
        aria-label={t("nav.search")}
      />
      {focused && <kbd className="nav-search__hint">↵</kbd>}
    </form>
  );
}

/** Logo — the uploaded image, otherwise the Xentium mark with the logo text or the site's name. */
export function NavLogo({ showWordmark = true }: { showWordmark?: boolean }) {
  const { data: branding } = useBranding();
  const siteName = useSiteConfig().data?.siteName;
  return (
    <NavLink to="/" className="pub-nav__logo">
      {/* The image is sized by CSS, not inline: the same block sits in the nav strip AND
          in a masthead band, and `--xt-logo-h` lets the context say how big (the
          codebase's rule about visual values living in tokens). */}
      <SiteLogo
        imgClassName="pub-nav__logo-img"
        markClassName="pub-nav__mark"
        wordmark={showWordmark && <span className="pub-nav__wordmark">{branding?.logoText || siteName || "Xentium"}</span>}
      />
    </NavLink>
  );
}


/**
 * Signed-in only — the block decides, not the admin.
 *
 * `withModTool` puts the ModCanvas shield beside the bell, which is where it lived
 * before it became a block of its own (`modTool`). The block passes it only for a
 * document that does not place the shield itself.
 */
export function NavNotifications({ withModTool = false, icon }: { withModTool?: boolean; icon?: string }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return withModTool ? <><ModShield /><NotificationBell icon={icon} /></> : <NotificationBell icon={icon} />;
}

/** The ModCanvas shield. Moderators only — it draws nothing for anyone else. */
export function NavModTool({ icon }: { icon?: string } = {}) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <ModShield icon={icon} /> : null;
}

/** Admins only; the badge flags pending plugin updates or an expiring licence. */
export function NavAdminLink() {
  const { t } = useTranslation("common");
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user || !hasAcpAccess(user)) return null;
  return (
    <NavLink
      to="/admin"
      className="pub-nav__icon-btn pub-nav__icon-btn--acp"
      aria-label={t("nav.adminPanel")}
      title={t("nav.adminPanel")}
    >
      <FontAwesomeIcon icon={faGear} />
      <AcpStatusBadge />
    </NavLink>
  );
}

/** Avatar dropdown when signed in; sign-in / register when not. */
export function NavUserMenu() {
  const { t } = useTranslation("common");
  const { user, isAuthenticated } = useAuth();
  const { open: registrationOpen } = useRegistrationStatus();

  if (isAuthenticated && user) return <UserDropdown user={user} />;
  return (
    <>
      {registrationOpen && (
        // Icons, not words: the guest's two doors take no more room than the member's
        // icons beside them. The name stays as the accessible label and the tooltip.
        <NavLink to="/register" className="pub-nav__register-btn pub-nav__guest-ico"
          aria-label={t("nav.register")} title={t("nav.register")}>
          <FontAwesomeIcon icon={faUserPlus} />
        </NavLink>
      )}
      {/* Opens a sign-in form under the button: the visitor stays on the page. */}
      <SignInMenu className="pub-nav__login-btn pub-nav__guest-ico" />
    </>
  );
}

/** Primary nav links — driven by the nav_items table. */
/**
 * The site's navigation links as a row of pills. Below 860px the row is hidden and
 * the links live in the hamburger menu instead (`NavMobileMenu`).
 */
export function NavPrimaryLinks() {
  const { t } = useTranslation("common");
  const { isAuthenticated } = useAuth();
  const navItems = useNavItems(isAuthenticated);
  return (
        <ul className="pub-nav__links">
          {navItems.map(item => {
            const isExternal = item.url.startsWith("http");
            // System links get a localized label by route; custom links keep their DB label.
            const navLabel = SYSTEM_NAV_I18N[item.url]
              ? t(SYSTEM_NAV_I18N[item.url]!)
              : pluginNavLabel(item.url, item.label);
            return (
              (item.children?.length ?? 0) > 0 && !isExternal && !item.openInNewTab ? (
                <NavDropdownLink key={item.id} item={item} label={navLabel} />
              ) : (
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
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginLeft: 4, fontSize: "var(--fs-2xs)" }} />
                    )}
                  </a>
                ) : (
                  <NavLink to={item.url}>{navLabel}</NavLink>
                )}
              </li>
              )
            );
          })}
        </ul>
  );
}

/**
 * A navbar link with links under it (ACP → Navigation, or a plugin's dropdown).
 * The label still goes to its own page; hovering opens the dropdown, and the caret
 * button opens it from the keyboard. Closes on a click outside, Escape, leaving
 * the link, and when the page changes. Drawn with the user menu's dropdown classes,
 * so it follows the same "Menus & dropdowns" tokens.
 */
function NavDropdownLink({ item, label }: { item: NavItem; label: string }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <li ref={ref} className="pub-nav__has-menu" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <NavLink to={item.url}>{label}</NavLink>
      <button type="button" className="pub-nav__menu-caret" aria-expanded={open} aria-haspopup="menu"
        aria-label={t("nav.openMenu", { label })} onClick={() => setOpen((o) => !o)}>
        <FontAwesomeIcon icon={faChevronDown} />
      </button>
      {open && (
        <div className="pub-nav__dropdown pub-nav__dropdown--nav xt-pop" role="menu">
          {item.children!.map((c) => (
            <NavLink key={c.id} role="menuitem" to={c.url} className="pub-nav__dropdown-item">
              {pluginNavLabel(c.url, c.label)}
            </NavLink>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The hamburger menu for narrow screens (≤860px): the navbar keeps the logo, the
 * bell and the account avatar, and everything else opens in a panel under it —
 * search, the navigation links as a list, and the tools the bar has no room for
 * (moderation, messages and other plugin buttons, the admin panel), passed in by
 * the navbar as `tools`. Closes on a link, on Escape, on a click outside and when
 * the page changes. Hidden on wider screens, where the bar shows all of it.
 */
export function NavMobileMenu({ tools }: { tools?: React.ReactNode }) {
  const { t } = useTranslation("common");
  const { isAuthenticated } = useAuth();
  const navItems = useNavItems(isAuthenticated);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const labelOf = (item: { url: string; label: string }) => SYSTEM_NAV_I18N[item.url]
    ? t(SYSTEM_NAV_I18N[item.url]!)
    : pluginNavLabel(item.url, item.label);

  return (
    <div className="pub-nav__burger" ref={ref}>
      <button type="button" className="pub-nav__burger-btn" aria-expanded={open}
        aria-label={t("nav.menu")} title={t("nav.menu")} onClick={() => setOpen((o) => !o)}>
        <FontAwesomeIcon icon={open ? faXmark : faBars} />
      </button>
      {open && (
        <div className="pub-nav__sheet" role="dialog" aria-label={t("nav.menu")}>
          <div className="pub-nav__sheet-search"><NavSearch alwaysOpen /></div>
          <nav className="pub-nav__sheet-links" aria-label={t("nav.menu")}>
            {navItems.map((item) => item.url.startsWith("http") || item.openInNewTab ? (
              <a key={item.id} href={item.url}
                target={item.openInNewTab ? "_blank" : undefined}
                rel={item.openInNewTab ? "noopener noreferrer" : undefined}>
                {labelOf(item)}
                {item.openInNewTab && <FontAwesomeIcon icon={faArrowUpRightFromSquare} />}
              </a>
            ) : (
              <Fragment key={item.id}>
                <NavLink to={item.url} end={item.url === "/"}>{labelOf(item)}</NavLink>
                {item.children?.map((c) => (
                  <NavLink key={c.id} to={c.url} className="pub-nav__sheet-sub">{labelOf(c)}</NavLink>
                ))}
              </Fragment>
            ))}
          </nav>
          {tools && <div className="pub-nav__sheet-tools">{tools}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * The public site chrome: ONE region, which is the header.
 *
 * The navbar is a BLOCK in it (`navbar`), not a peer of it — a navbar is part of a
 * header, which is what a header is. Everything else an admin puts up there is a
 * block in the same list, so ordering a masthead above or below the nav strip is
 * moving blocks, not choosing between purpose-built slots.
 *
 * This replaced `left`/`center`/`right` regions plus two `band*` regions I had added
 * for a masthead. Which end of the strip a block sits at is now `align` on the node.
 *
 * ⚠ `<header>` is emitted by `LayoutRegion` (the region is named `header`), not here,
 * so the landmark comes from the same place on every template. `.pub-head` only
 * exists to dissolve its own box — see the SCSS: a real wrapper made the sticky
 * navbar stick only until the header scrolled past.
 *
 * The ACP topbar is deliberately NOT composable — see the amendment.
 */
export function PubNav() {
  const layout = useLayoutDocument("chrome.header");
  return (
    <div className="pub-head">
      <LayoutRegion document={layout} region="header" />
    </div>
  );
}
