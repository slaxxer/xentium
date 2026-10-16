import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useSiteConfig, type SiteAlert } from "../hooks/useSiteConfig";
import { useMaintenance } from "../features/maintenance/useMaintenance";
import { userCan } from "../lib/authStore";
import "./SiteBars.scss";

/**
 * The strip under the navbar on every public page, inside the site frame, so it
 * takes the layout's width (edge to edge, the box, or its own card when floating).
 * The marketplace's look. Two things use it:
 *
 *   - maintenance: staff who are let through see that the site is closed to
 *     everyone else, with a way to turn it off when they may;
 *   - the site alert an admin writes in Settings → Site alert.
 */
export function SiteBars() {
  return (
    <>
      <MaintenanceBar />
      <AlertBar />
    </>
  );
}

function MaintenanceBar() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { data: m } = useMaintenance(true);
  // Anyone seeing the site while it is on was let through the maintenance gate.
  if (!m?.enabled || !user) return null;
  return (
    <div className="xt-siteBar xt-siteBar--warning" role="status">
      {t("siteBar.maintenance")}{" "}
      {userCan(user, "admin.access") && (
        <Link to="/admin/settings?section=maintenance">{t("siteBar.turnOff")}</Link>
      )}
    </div>
  );
}

/** Dismissal is per viewer and per message: a new alert shows again. */
function alertId(a: SiteAlert): string {
  const text = `${a.message}|${a.link?.url ?? ""}`;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `xt-alert-dismissed:${h}`;
}

function readDismissed(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function AlertBar() {
  const { t } = useTranslation("common");
  const { user, isLoading } = useAuth();
  const { data } = useSiteConfig();
  const alert = data?.alert ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!alert) return null;
  // Narrowed alerts wait for auth, so a member never sees the guests' one flash by.
  if (alert.audience !== "everyone" && isLoading) return null;
  if (alert.audience === "guests" && user) return null;
  if (alert.audience === "members" && !user) return null;

  const id = alertId(alert);
  if (alert.dismissible && (dismissed === id || readDismissed(id))) return null;

  const dismiss = () => {
    try { localStorage.setItem(id, "1"); } catch { /* still hidden for this visit */ }
    setDismissed(id);
  };
  const internal = alert.link?.url.startsWith("/");

  return (
    <div className={`xt-siteBar xt-siteBar--${alert.tone}`} role="status">
      <span>{alert.message}</span>
      {alert.link && (
        <>
          {" "}
          {internal
            ? <Link to={alert.link.url}>{alert.link.label}</Link>
            : <a href={alert.link.url} rel="noreferrer">{alert.link.label}</a>}
        </>
      )}
      {alert.dismissible && (
        <button type="button" className="xt-siteBar__close" onClick={dismiss} aria-label={t("siteBar.dismiss")}>
          ×
        </button>
      )}
    </div>
  );
}
