import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUser,
  faLock,
  faBell,
  faPalette,
  faShield,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../hooks/useAuth";
import { ProfileTab } from "./tabs/ProfileTab";
import { SecurityTab } from "./tabs/SecurityTab";
import { NotificationsTab } from "./tabs/NotificationsTab";
import { PreferencesTab } from "./tabs/PreferencesTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
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
  const { isAuthenticated, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const tabParam = searchParams.get("tab");
    return (tabParam && TABS.some((x) => x.id === tabParam) ? tabParam : "profile") as Tab;
  });

  if (isLoading) return <div className="account-loading">{t("actions.loading", { ns: "common" })}</div>;
  if (!isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="account-page">
      <div className="account-header">
        <h1 className="account-title">{t("nav.accountSettings", { ns: "common" })}</h1>
      </div>

      <div className="account-layout">
        <nav className="account-nav">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`account-nav__item${tab === item.id ? " account-nav__item--active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <FontAwesomeIcon icon={item.icon} className="account-nav__icon" />
              {t(`tabs.${item.id}`)}
            </button>
          ))}
        </nav>

        <div className="account-content">
          {tab === "profile" && <ProfileTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "privacy" && <PrivacyTab />}
        </div>
      </div>
    </div>
  );
}
