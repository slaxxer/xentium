/**
 * Account settings — the shell.
 *
 * Two columns: a STICKY rail that is the whole navigation (a search box over five
 * sections, each carrying the one fact worth knowing about it), and the section
 * itself. Nothing is hidden behind an accordion any more — see `AccountCard`.
 *
 * ⚠ The rail's badges are the point of the rail. "PIN off" and "8 on" answer the two
 * questions people actually arrive with, without opening the section; a nav that
 * only lists names makes you visit all five to find the one that is wrong.
 *
 * ⚠ The tab lives in the URL (`?tab=`), and the rail WRITES it as well as reads it.
 * A settings page is the thing people link each other to ("it's under Privacy"), and
 * a deep link that cannot be produced by using the page is not a deep link.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUser, faLock, faBell, faPalette, faShield,
  faMagnifyingGlass, faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { ProfileTab } from "./tabs/ProfileTab";
import { SecurityTab } from "./tabs/SecurityTab";
import { NotificationsTab } from "./tabs/NotificationsTab";
import { PreferencesTab } from "./tabs/PreferencesTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
import { type NotifPrefs, NOTIF_DEFAULTS } from "./tabs/NotificationsTab";
import "./AccountPage.scss";

type Tab = "profile" | "security" | "notifications" | "preferences" | "privacy";

const TABS: { id: Tab; icon: IconDefinition }[] = [
  { id: "profile",       icon: faUser    },
  { id: "security",      icon: faLock    },
  { id: "notifications", icon: faBell    },
  { id: "preferences",   icon: faPalette },
  { id: "privacy",       icon: faShield  },
];

export function AccountPage() {
  const { t } = useTranslation(["account", "common"]);
  const { isAuthenticated, isLoading, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const param = searchParams.get("tab");
  const tab: Tab = (param && TABS.some((x) => x.id === param) ? param : "profile") as Tab;
  const setTab = (next: Tab) => setSearchParams(next === "profile" ? {} : { tab: next }, { replace: true });

  /**
   * Read for the rail's notification count ONLY.
   *
   * ⚠ Same query key as the Notifications tab, so opening that tab costs no second
   * request and toggling a switch there updates this badge — one cache, two readers.
   */
  const notifs = useQuery<NotifPrefs>({
    queryKey: ["account-notif-prefs"],
    queryFn:  () => api.get("/account/notifications"),
    enabled:  isAuthenticated,
  });

  const meta = useMemo(() => {
    const p = notifs.data ?? NOTIF_DEFAULTS;
    const on = Object.values(p.inApp).filter(Boolean).length
             + Object.values(p.email).filter(Boolean).length;
    return {
      security:      user?.loginPinEnabled ? t("account:nav.pinOn") : t("account:nav.pinOff"),
      notifications: notifs.data ? t("account:nav.onCount", { count: on }) : "",
    } as Partial<Record<Tab, string>>;
  }, [notifs.data, user?.loginPinEnabled, t]);

  /** Searching the nav searches what each section CONTAINS, not just its name. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((x) => {
      const hay = `${t(`account:tabs.${x.id}`)} ${t(`account:nav.keywords.${x.id}`)}`;
      return hay.toLowerCase().includes(q);
    });
  }, [query, t]);

  if (isLoading) return <div className="account-loading">{t("common:actions.loading")}</div>;
  if (!isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="account-page">
      <div className="acct-head">
        <div>
          <h1>{t("common:nav.accountSettings")}</h1>
          <p>{t("account:pageSub")}</p>
        </div>
        {user && (
          <Link className="acct-btn" to={`/u/${user.username}`}>
            <FontAwesomeIcon className="acct-ic" icon={faArrowUpRightFromSquare} />
            {t("account:viewProfile")}
          </Link>
        )}
      </div>

      <div className="acct-layout">
        <div className="acct-rail">
          <div className="acct-search">
            <FontAwesomeIcon className="acct-ic" icon={faMagnifyingGlass} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("account:searchPlaceholder")}
              aria-label={t("account:searchPlaceholder")}
            />
          </div>

          <nav className="acct-nav">
            {shown.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`acct-nav__item${tab === item.id ? " is-on" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <FontAwesomeIcon className="acct-ic" icon={item.icon} />
                <span className="acct-nav__label">{t(`account:tabs.${item.id}`)}</span>
                {meta[item.id] && <em>{meta[item.id]}</em>}
              </button>
            ))}
            {shown.length === 0 && (
              <p className="acct-nav__empty">{t("account:searchNoMatch", { query })}</p>
            )}
          </nav>
        </div>

        <div className="acct-content">
          {tab === "profile"       && <ProfileTab onGoTo={setTab} />}
          {tab === "security"      && <SecurityTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "preferences"   && <PreferencesTab />}
          {tab === "privacy"       && <PrivacyTab />}
        </div>
      </div>
    </div>
  );
}
