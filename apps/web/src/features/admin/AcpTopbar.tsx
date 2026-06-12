import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useAuth, applyLogout } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { Avatar } from "../../components/Avatar";
import { NotificationBell } from "../../components/NotificationBell";
import { slotRegistry } from "../../plugins/slotRegistry";
import { AcpIcon, type AcpIconName } from "./pages/acpIcons";
import "./AcpTopbar.scss";

// ── Command-palette index — mirrors the real ACP nav (AcpLayout `NAV`).
//    label/sub are `acp` i18n keys, resolved at render. ───────────────────────
interface NavEntry { labelKey: string; subKey: string; icon: AcpIconName; to: string }

const NAV_INDEX: NavEntry[] = [
  { labelKey: "nav.dashboard",        subKey: "nav.overview",      icon: "dashboard", to: "/admin" },
  { labelKey: "nav.userList",         subKey: "nav.users",         icon: "user",      to: "/admin/users" },
  { labelKey: "nav.groups",           subKey: "nav.users",         icon: "user",      to: "/admin/groups" },
  { labelKey: "nav.profileFields",    subKey: "nav.users",         icon: "user",      to: "/admin/profile-fields" },
  { labelKey: "nav.permissions",      subKey: "nav.accessControl", icon: "layers",    to: "/admin/permissions" },
  { labelKey: "nav.progression",      subKey: "nav.accessControl", icon: "layers",    to: "/admin/progression" },
  { labelKey: "nav.articles",         subKey: "nav.content",       icon: "file",      to: "/admin/articles" },
  { labelKey: "nav.categories",       subKey: "nav.content",       icon: "file",      to: "/admin/categories" },
  { labelKey: "nav.reviewCases",      subKey: "nav.moderation",    icon: "shield",    to: "/admin/cases" },
  { labelKey: "nav.modLog",           subKey: "nav.moderation",    icon: "shield",    to: "/admin/modlog" },
  { labelKey: "nav.modSettings",      subKey: "nav.moderation",    icon: "shield",    to: "/admin/modsettings" },
  { labelKey: "nav.styleEditor",      subKey: "nav.appearance",    icon: "palette",   to: "/admin/style-editor" },
  { labelKey: "nav.styles",           subKey: "nav.appearance",    icon: "palette",   to: "/admin/styles" },
  { labelKey: "nav.styleHistory",     subKey: "nav.appearance",    icon: "palette",   to: "/admin/style-history" },
  { labelKey: "nav.navigation",       subKey: "nav.appearance",    icon: "palette",   to: "/admin/navigation" },
  { labelKey: "Guest Home",           subKey: "nav.appearance",    icon: "palette",   to: "/admin/guest-home" },
  { labelKey: "nav.marketplace",      subKey: "nav.extensions",    icon: "puzzle",    to: "/admin/marketplace" },
  { labelKey: "nav.installed",        subKey: "nav.extensions",    icon: "puzzle",    to: "/admin/installed" },
  { labelKey: "nav.upload",           subKey: "nav.extensions",    icon: "puzzle",    to: "/admin/upload" },
  { labelKey: "nav.license",          subKey: "nav.extensions",    icon: "puzzle",    to: "/admin/license" },
  { labelKey: "nav.settings",         subKey: "nav.system",        icon: "cog",       to: "/admin/settings" },
  { labelKey: "nav.scheduledTasks",   subKey: "nav.system",        icon: "cog",       to: "/admin/scheduled-tasks" },
  { labelKey: "nav.errorReference",   subKey: "nav.system",        icon: "cog",       to: "/admin/error-ref" },
  { labelKey: "nav.errorLog",         subKey: "nav.system",        icon: "cog",       to: "/admin/error-log" },
  { labelKey: "nav.migrationHistory", subKey: "nav.system",        icon: "cog",       to: "/admin/migration-history" },
  { labelKey: "nav.about",            subKey: "nav.system",        icon: "cog",       to: "/admin/about" },
];

interface PaletteItem {
  kind: "Navigation" | "Actions";
  id: string;
  label: string;
  sub: string;
  icon: AcpIconName;
  to?: string;
  run?: () => void;
}
const KIND_ORDER: PaletteItem["kind"][] = ["Actions", "Navigation"];

function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  return ref;
}

function highlight(label: string, q: string) {
  if (!q) return label;
  const i = label.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return label;
  return <>{label.slice(0, i)}<mark>{label.slice(i, i + q.length)}</mark>{label.slice(i + q.length)}</>;
}

// ── Command-palette search ─────────────────────────────────────────────────────
function NavSearch() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("acp");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useDismiss(open, () => setOpen(false));

  const index: PaletteItem[] = useMemo(() => {
    const actions: PaletteItem[] = [
      { kind: "Actions", id: "Actions:viewSite", label: t("topbar.viewLiveSite"), sub: t("topbar.openPublicSite"), icon: "external", run: () => navigate("/") },
    ];
    const nav: PaletteItem[] = NAV_INDEX.map((n) => ({
      kind: "Navigation", id: `Navigation:${n.to}`, label: t(n.labelKey), sub: t(n.subKey), icon: n.icon, to: n.to,
    }));
    return [...actions, ...nav];
  }, [navigate, t, i18n.language]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return index.slice(0, 7);
    return index.filter((it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q)).slice(0, 9);
  }, [q, index]);

  const groups = useMemo(() => {
    const m: Record<string, PaletteItem[]> = {};
    filtered.forEach((it) => { (m[it.kind] ||= []).push(it); });
    return KIND_ORDER.filter((k) => m[k]).map((k) => [k, m[k]!] as const);
  }, [filtered]);
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    if (!flat.length) { setActiveId(null); return; }
    if (!flat.some((it) => it.id === activeId)) setActiveId(flat[0]!.id);
  }, [flat, activeId]);

  const activate = useCallback((it: PaletteItem) => {
    setOpen(false); setQuery("");
    if (it.run) it.run();
    else if (it.to) navigate(it.to);
  }, [navigate]);

  // ⌘K / Ctrl+K opens + focuses the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!flat.length) return;
    const i = Math.max(0, flat.findIndex((it) => it.id === activeId));
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveId(flat[(i + 1) % flat.length]!.id); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveId(flat[(i - 1 + flat.length) % flat.length]!.id); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[i]) activate(flat[i]!); }
  };

  const groupLabel = (kind: string) => kind === "Actions" ? t("topbar.groupActions") : t("topbar.groupNavigation");

  return (
    <div className={`nbsearch${open ? " is-open" : ""}`} ref={wrapRef}>
      <div className="nbsearch__field" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <AcpIcon name="search" size={16} className="nbsearch__ic" />
        <input
          ref={inputRef}
          className="nbsearch__input"
          type="text"
          placeholder={t("topbar.searchPlaceholder")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query
          ? <button type="button" className="nbsearch__clear" aria-label={t("topbar.clear")} onClick={() => { setQuery(""); inputRef.current?.focus(); }}>×</button>
          : <kbd className="nbsearch__kbd">⌘K</kbd>}
      </div>

      {open && (
        <div className="nbpal">
          {flat.length === 0 ? (
            <div className="nbpal__empty">
              <AcpIcon name="search" size={22} />
              <p>{t("topbar.noMatchesFor")} <b>{query.trim()}</b></p>
              <span>{t("topbar.tryPageOrAction")}</span>
            </div>
          ) : (
            <div className="nbpal__list">
              {!q && <div className="nbpal__hint">{t("topbar.jumpTo")}</div>}
              {groups.map(([kind, items]) => (
                <div className="nbpal__group" key={kind}>
                  <div className="nbpal__glabel">{groupLabel(kind)}</div>
                  {items.map((it) => {
                    const isAct = it.id === activeId;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`nbpal__item${isAct ? " is-active" : ""}`}
                        onMouseEnter={() => setActiveId(it.id)}
                        onClick={() => activate(it)}
                      >
                        <span className={`nbpal__ic nbpal__ic--${it.kind.toLowerCase()}`}>
                          <AcpIcon name={it.icon} size={16} />
                        </span>
                        <span className="nbpal__txt">
                          <b>{highlight(it.label, query.trim())}</b>
                          <span>{it.sub}</span>
                        </span>
                        {it.run
                          ? <span className="nbpal__tag">{t("topbar.run")}</span>
                          : <AcpIcon name="cornerDown" size={14} className="nbpal__enter" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="nbpal__foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> {t("topbar.footNavigate")}</span>
            <span><kbd>↵</kbd> {t("topbar.footOpen")}</span>
            <span><kbd>esc</kbd> {t("topbar.footClose")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── User menu ──────────────────────────────────────────────────────────────────
function UserMenu() {
  const navigate = useNavigate();
  const { t } = useTranslation("acp");
  const { user } = useAuth();
  const { theme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  if (!user) return null;

  const primary = [...user.groups].sort((a, b) => a.displayOrder - b.displayOrder)[0];
  const role = primary?.badgeLabel ?? primary?.name ?? t("topbar.roleFallback");

  const close = () => setOpen(false);
  const onLogout = async () => {
    close();
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    applyLogout();
    navigate("/");
  };

  return (
    <div className="nbmenu" ref={ref}>
      <button type="button" className={`nbuser${open ? " is-active" : ""}`} onClick={() => setOpen((o) => !o)}>
        <Avatar user={{ username: user.username, avatar: user.avatar }} size={34} online presenceSize={11} />
        <span className="nbuser__id">
          <b>{user.username}</b>
          <span>{role}</span>
        </span>
        <AcpIcon name="chevron" size={15} className="nbuser__chev" />
      </button>

      {open && (
        <div className="nbpop nbpop--user">
          <div className="nbuser__card">
            <Avatar user={{ username: user.username, avatar: user.avatar }} size={46} online presenceSize={12} />
            <div className="nbuser__cardid">
              <b>{user.username}</b>
              <span>{user.email}</span>
            </div>
            <span className="nbrole">{role}</span>
          </div>

          <div className="nbpop__sect">
            <Link to={`/u/${user.username}`} className="nbmi" onClick={close}>
              <span className="nbmi__ic"><AcpIcon name="userCircle" size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.yourProfile")}</span>
            </Link>
            <Link to="/account" className="nbmi" onClick={close}>
              <span className="nbmi__ic"><AcpIcon name="at" size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.accountSecurity")}</span>
            </Link>
            <Link to="/account" className="nbmi" onClick={close}>
              <span className="nbmi__ic"><AcpIcon name="sliders" size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.preferences")}</span>
            </Link>
          </div>

          <div className="nbpop__sect">
            <div className="nbmi nbmi--theme">
              <span className="nbmi__ic"><AcpIcon name={theme === "dark" ? "moon" : "sun"} size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.appearance")}</span>
              <div className="nbseg" role="group" aria-label={t("topbar.appearance")}>
                <button type="button" className={theme === "light" ? "is-on" : ""} onClick={() => setPreference("light")}>{t("topbar.themeLight")}</button>
                <button type="button" className={theme === "dark" ? "is-on" : ""} onClick={() => setPreference("dark")}>{t("topbar.themeDark")}</button>
              </div>
            </div>
          </div>

          <div className="nbpop__sect">
            <button type="button" className="nbmi nbmi--danger" onClick={onLogout}>
              <span className="nbmi__ic"><AcpIcon name="logout" size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.signOut")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
        <nav className="acp-crumbs" aria-label="Breadcrumb">
          {crumbKeys.map((key, i) => (
            <span key={key} style={{ display: "contents" }}>
              {i > 0 && <span className="sep">/</span>}
              {i === crumbKeys.length - 1 ? <b>{t(key)}</b> : <span>{t(key)}</span>}
            </span>
          ))}
        </nav>
        <NavSearch />
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
        {slotRegistry.getHeaderWidgets().map((w) => (
          <w.component key={w.id} />
        ))}
        <NotificationBell />
        <span className="nbdiv" />
        <UserMenu />
      </div>
    </header>
  );
}
