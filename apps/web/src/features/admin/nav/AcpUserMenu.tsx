import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { useAuth, applyLogout } from "../../../hooks/useAuth";
import { useTheme } from "../../../hooks/useTheme";
import { Avatar } from "../../../components/Avatar";
import { AcpIcon } from "../pages/acpIcons";
import { useDismiss } from "./useDismiss";
import { useAcpLayout, setAcpLayout } from "./acpChrome";

/**
 * The admin's own menu: profile, account, appearance, sign out.
 *
 * Two shapes, one implementation:
 *   `bar`  — the horizontal chrome. Avatar + name + role + chevron, popup
 *            hanging below the button and pinned to its right edge.
 *   `rail` — the icon rail. Avatar alone at the foot of a 72px column, so the
 *            popup opens UP and to the RIGHT. Anything else would leave the
 *            menu hanging off the bottom-left corner of the screen.
 *
 * The chrome switch lives here rather than in a settings page because this is
 * already the menu for "how this panel looks to me" — it sits directly under
 * the light/dark segment, which is the same kind of choice.
 */
export function AcpUserMenu({ variant = "bar" }: { variant?: "bar" | "rail" }) {
  const navigate = useNavigate();
  const { t } = useTranslation("acp");
  const { user } = useAuth();
  const { theme, setPreference } = useTheme();
  const layout = useAcpLayout();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

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

  const avatar = { username: user.username, avatar: user.avatar };

  return (
    <div className={`nbmenu nbmenu--${variant}`} ref={ref}>
      {variant === "rail" ? (
        <button
          type="button"
          className={`nbrailuser${open ? " is-active" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title={user.username}
          aria-label={user.username}
        >
          <Avatar user={avatar} size={34} online presenceSize={11} />
        </button>
      ) : (
        <button type="button" className={`nbuser${open ? " is-active" : ""}`} onClick={() => setOpen((o) => !o)}>
          <Avatar user={avatar} size={34} online presenceSize={11} />
          <span className="nbuser__id">
            <b>{user.username}</b>
            <span>{role}</span>
          </span>
          <AcpIcon name="chevron" size={15} className="nbuser__chev" />
        </button>
      )}

      {open && (
        <div className={`nbpop nbpop--user nbpop--${variant}`}>
          <div className="nbuser__card">
            <Avatar user={avatar} size={46} online presenceSize={12} />
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
            <div className="nbmi nbmi--theme">
              <span className="nbmi__ic"><AcpIcon name="layers" size={16} /></span>
              <span className="nbmi__lbl">{t("topbar.navLayout")}</span>
              <div className="nbseg" role="group" aria-label={t("topbar.navLayout")}>
                <button type="button" className={layout === "rail" ? "is-on" : ""} onClick={() => setAcpLayout("rail")}>{t("topbar.navLayoutRail")}</button>
                <button type="button" className={layout === "horizontal" ? "is-on" : ""} onClick={() => setAcpLayout("horizontal")}>{t("topbar.navLayoutTop")}</button>
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
