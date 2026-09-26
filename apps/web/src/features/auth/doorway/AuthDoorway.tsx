import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { faGlobe } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { UserAvatar } from "../../../components/UserAvatar";
import { api } from "../../../lib/api";
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from "../../../lib/i18n";
import type { AuthMethods } from "./signInClient";
import "./Doorway.scss";

// The one page people meet before they are members: sign in, create an account,
// get back in. A welcome side about the community, and a card with the form.
// Every screen of the flow renders inside this shell (see doorway/*Panel.tsx).

export interface DoorwayStats {
  siteName: string;
  tagline: string;
  members: number;
  online: number;
  joinedThisWeek: number;
  recent: Array<{ username: string; avatar: string | null }>;
}

/** Which sign-in methods this install offers. Buttons for anything else are never drawn. */
export function useAuthMethods() {
  return useQuery<AuthMethods>({
    queryKey: ["auth-methods"],
    queryFn: () => api.get("/auth/methods"),
    staleTime: 5 * 60_000,
  });
}

export function useDoorwayStats() {
  return useQuery<DoorwayStats>({
    queryKey: ["auth-doorway"],
    queryFn: () => api.get("/auth/doorway"),
    staleTime: 60_000,
  });
}

export function AuthDoorway({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  const { t } = useTranslation("auth");
  return (
    <div className="dw">
      <WelcomeSide />
      <main className="dw-main">
        <div className="dw-card">
          {tabs && (
            <nav className="dw-tabs" aria-label={t("door.tabs.label")}>
              <NavLink to="/login" end className={({ isActive }) => (isActive ? "is-on" : "")}>{t("door.tabs.signIn")}</NavLink>
              <NavLink to="/register" className={({ isActive }) => (isActive ? "is-on" : "")}>{t("door.tabs.register")}</NavLink>
            </nav>
          )}
          <div className="dw-body">{children}</div>
          <LocaleMenu />
        </div>
      </main>
    </div>
  );
}

function WelcomeSide() {
  const { t } = useTranslation("auth");
  const { data } = useDoorwayStats();
  const fmt = (n: number) => n.toLocaleString();
  const others = Math.max(0, (data?.joinedThisWeek ?? 0) - Math.min(2, data?.recent.length ?? 0));

  return (
    <aside className="dw-side">
      <div className="dw-side__art" aria-hidden />
      <Link to="/" className="dw-brand">
        <span className="dw-brand__mark" aria-hidden><span /></span>
        <span className="dw-brand__name">{data?.siteName ?? "Xentium"}</span>
      </Link>

      <div className="dw-side__hero">
        <p className="dw-side__eyebrow">{t("door.side.welcome")}</p>
        <h2 className="dw-side__title">{data?.siteName ?? ""}</h2>
        <p className="dw-side__tagline">{data?.tagline || t("door.side.tagline")}</p>

        {data && (
          <div className="dw-stats">
            <div className="dw-stat">
              <strong><span className="dw-live" aria-hidden />{fmt(data.online)}</strong>
              <span>{t("door.side.online")}</span>
            </div>
            <div className="dw-stat">
              <strong>{fmt(data.members)}</strong>
              <span>{t("door.side.members", { count: data.members })}</span>
            </div>
            {data.recent.length > 0 && (
              <div className="dw-stat dw-stat--people">
                <span className="dw-faces">
                  {data.recent.map((u) => <UserAvatar key={u.username} user={u} size={28} />)}
                </span>
                <span className="dw-joined">
                  {others > 0
                    ? t("door.side.joinedMany", { a: data.recent[0]!.username, b: data.recent[1]?.username ?? "", count: others })
                    : data.recent.length > 1
                      ? t("door.side.joinedTwo", { a: data.recent[0]!.username, b: data.recent[1]!.username })
                      : t("door.side.joinedOne", { a: data.recent[0]!.username })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function LocaleMenu() {
  const { i18n, t } = useTranslation("auth");
  return (
    <label className="dw-locale">
      <FontAwesomeIcon icon={faGlobe} />
      <span className="dw-sr">{t("door.language")}</span>
      <select value={i18n.resolvedLanguage ?? i18n.language} onChange={(e) => setLocale(e.target.value as LocaleCode)}>
        {SUPPORTED_LOCALES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
      </select>
    </label>
  );
}
