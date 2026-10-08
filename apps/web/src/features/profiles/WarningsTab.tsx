/**
 * Profile → Warnings: a member's standing, for the member and for staff only (the
 * server refuses everyone else — GET /users/:id/standing).
 *
 * The member reads their warnings (active, expired, pardoned) with who issued each,
 * the escalation ladder, and — when the next warning would trigger a sanction — an
 * alert that says so before it happens. Staff also see the member's bans and the IP
 * addresses they used, with the country each belongs to.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  faTriangleExclamation, faShieldHalved, faGavel, faNetworkWired, faCircleCheck, faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { UserAvatar } from "../../components/UserAvatar";
import { api } from "../../lib/api";
import "./WarningsTab.scss";

type Status = "active" | "expired" | "pardoned";
interface Warning {
  id: string; reason: string; status: Status;
  createdAt: string; expiresAt: string | null; pardonedAt: string | null; pardonedBy: string | null;
  issuedBy: { username: string; avatar?: string | null };
}
interface Step { warningCount: number; action: "notify" | "ban_temporary" | "ban_permanent"; banDays: number | null }
interface Ban {
  id: string; type: "temporary" | "permanent"; reason: string; status: string;
  expiresAt: string | null; createdAt: string; issuedBy: { username: string };
}
interface Ip { ip: string; country: string | null; firstSeen: string; lastSeen: string; uses: number; otherAccounts: number }
interface Standing {
  isOwn: boolean; isStaff: boolean; counted: number; expiryDays: number | null;
  ladder: Step[];
  next: (Step & { remaining: number }) | null;
  warnings: Warning[];
  bans?: Ban[];
  ips?: Ip[];
  geoip?: { available: boolean };
}

const DAY = 86400e3;

/** 🇩🇪 from "DE": two regional-indicator letters. */
const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function WarningsTab({ profileId, username, isOwn }: { profileId: string; username: string; isOwn: boolean }) {
  const { t, i18n } = useTranslation("profiles");
  const { data, isLoading, error } = useQuery<Standing>({
    queryKey: ["profile-standing", profileId],
    queryFn: () => api.get(`/users/${profileId}/standing`),
  });

  if (isLoading) return <p className="std-muted">{t("standing.loading")}</p>;
  if (error || !data) return <p className="std-muted">{t("standing.error")}</p>;

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" });
  const regionName = (() => {
    try { return new Intl.DisplayNames([i18n.language], { type: "region" }); } catch { return null; }
  })();
  const sanction = (s: Step) => s.action === "ban_permanent"
    ? t("standing.banPermanent")
    : t("standing.banDays", { count: s.banDays ?? 0 });

  const groups: Array<{ key: Status; items: Warning[] }> = (["active", "expired", "pardoned"] as const)
    .map((key) => ({ key, items: data.warnings.filter((w) => w.status === key) }));
  const steps = data.ladder.filter((s) => s.action !== "notify");

  return (
    <div className="std">
      {/* One more and the ladder bans: say it BEFORE it happens. */}
      {data.next && data.next.remaining === 1 && (
        <div className={`std-alert${data.next.action === "ban_permanent" ? " std-alert--severe" : ""}`} role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} className="std-alert__icon" />
          <div>
            <b>{isOwn ? t("standing.alertOwnTitle") : t("standing.alertStaffTitle", { name: username })}</b>
            <p>
              {isOwn
                ? t("standing.alertOwn", { sanction: sanction(data.next) })
                : t("standing.alertStaff", { name: username, sanction: sanction(data.next) })}
              {data.expiryDays && ` ${t("standing.alertExpiry", { count: data.expiryDays })}`}
            </p>
          </div>
        </div>
      )}

      {/* Where they stand: the count that matters and the ladder it climbs. */}
      <section className="std-card std-summary">
        <div className="std-summary__count">
          <span className="std-summary__n">{data.counted}</span>
          <span>{t("standing.counted", { count: data.counted })}</span>
        </div>
        {steps.length > 0 && (
          <ol className="std-ladder" aria-label={t("standing.ladder")}>
            {steps.map((s) => (
              <li key={s.warningCount} className={data.counted >= s.warningCount ? "is-reached" : data.next?.warningCount === s.warningCount ? "is-next" : ""}>
                <b>{t("standing.atWarnings", { count: s.warningCount })}</b>
                <span>{sanction(s)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="std-muted std-summary__note">
          {data.expiryDays ? t("standing.expiryNote", { count: data.expiryDays }) : t("standing.noExpiry")}
        </p>
      </section>

      {/* The warnings themselves, by state. */}
      <section className="std-card">
        <h3 className="std-h"><FontAwesomeIcon icon={faShieldHalved} /> {t("standing.warnings")}</h3>
        {data.warnings.length === 0 ? (
          <p className="std-empty"><FontAwesomeIcon icon={faCircleCheck} /> {isOwn ? t("standing.noneOwn") : t("standing.noneOther", { name: username })}</p>
        ) : groups.filter((g) => g.items.length).map((g) => (
          <div key={g.key} className="std-group">
            <h4 className={`std-group__h std-group__h--${g.key}`}>{t(`standing.status.${g.key}`)} · {g.items.length}</h4>
            <ul className="std-list">
              {g.items.map((w) => {
                const total = w.expiresAt ? new Date(w.expiresAt).getTime() - new Date(w.createdAt).getTime() : 0;
                const left = w.expiresAt ? Math.max(0, new Date(w.expiresAt).getTime() - Date.now()) : 0;
                return (
                  <li key={w.id} className={`std-item std-item--${w.status}`}>
                    <p className="std-item__reason">{w.reason}</p>
                    <div className="std-item__meta">
                      <span className="std-who">
                        <UserAvatar user={{ username: w.issuedBy.username, avatar: w.issuedBy.avatar ?? null }} size={20} />
                        {t("standing.issuedBy", { name: w.issuedBy.username })}
                      </span>
                      <span>{date(w.createdAt)}</span>
                      {w.status === "active" && (w.expiresAt
                        ? <span>{t("standing.expiresIn", { count: Math.max(1, Math.ceil(left / DAY)) })}</span>
                        : <span>{t("standing.neverExpires")}</span>)}
                      {w.status === "expired" && w.expiresAt && <span>{t("standing.expiredOn", { date: date(w.expiresAt) })}</span>}
                      {w.status === "pardoned" && (
                        <span>{w.pardonedBy
                          ? t("standing.pardonedBy", { name: w.pardonedBy, date: w.pardonedAt ? date(w.pardonedAt) : "" })
                          : t("standing.pardoned")}</span>
                      )}
                    </div>
                    {w.status === "active" && total > 0 && (
                      <span className="std-bar" aria-hidden><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {/* Staff only: bans and where the account signs in from. */}
      {data.isStaff && data.bans && (
        <section className="std-card">
          <h3 className="std-h"><FontAwesomeIcon icon={faGavel} /> {t("standing.bans")} <span className="std-staff">{t("standing.staffOnly")}</span></h3>
          {data.bans.length === 0 ? <p className="std-empty">{t("standing.noBans")}</p> : (
            <ul className="std-list">
              {data.bans.map((b) => (
                <li key={b.id} className={`std-item std-item--${b.status === "active" ? "active" : "expired"}`}>
                  <p className="std-item__reason">{b.reason}</p>
                  <div className="std-item__meta">
                    <span className={`std-tag${b.status === "active" ? " std-tag--live" : ""}`}>
                      {b.type === "permanent" ? t("standing.banPermanentShort") : t("standing.banTemporaryShort")} · {t(`standing.banStatus.${b.status}`, { defaultValue: b.status })}
                    </span>
                    <span>{t("standing.issuedBy", { name: b.issuedBy.username })}</span>
                    <span>{date(b.createdAt)}{b.expiresAt && ` → ${date(b.expiresAt)}`}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.isStaff && data.ips && (
        <section className="std-card">
          <h3 className="std-h"><FontAwesomeIcon icon={faNetworkWired} /> {t("standing.ips")} <span className="std-staff">{t("standing.staffOnly")}</span></h3>
          {data.ips.length === 0 ? <p className="std-empty">{t("standing.noIps")}</p> : (
            <div className="std-ips" role="table">
              <div className="std-ips__row std-ips__row--head" role="row">
                <span role="columnheader">{t("standing.ipCol")}</span>
                <span role="columnheader">{t("standing.countryCol")}</span>
                <span role="columnheader">{t("standing.seenCol")}</span>
                <span role="columnheader">{t("standing.sharedCol")}</span>
              </div>
              {data.ips.map((ip) => (
                <div key={ip.ip} className="std-ips__row" role="row">
                  <code role="cell">{ip.ip}</code>
                  <span role="cell">
                    {ip.country
                      ? <>{flagOf(ip.country)} {regionName?.of(ip.country) ?? ip.country}</>
                      : <span className="std-muted">{t("standing.countryUnknown")}</span>}
                  </span>
                  <span role="cell" className="std-muted">{date(ip.lastSeen)} · {t("standing.uses", { count: ip.uses })}</span>
                  <span role="cell">
                    {ip.otherAccounts > 0
                      ? <span className="std-tag std-tag--warn"><FontAwesomeIcon icon={faUsers} /> {t("standing.otherAccounts", { count: ip.otherAccounts })}</span>
                      : <span className="std-muted">—</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* DB-IP's licence (CC BY 4.0) asks for this credit wherever the data shows. */}
          {data.geoip?.available
            ? <p className="std-credit"><a href="https://db-ip.com" target="_blank" rel="noreferrer">{t("standing.geoCredit")}</a></p>
            : <p className="std-credit">{t("standing.geoMissing")} <Link to="/admin/scheduled-tasks">{t("standing.geoMissingLink")}</Link></p>}
        </section>
      )}
    </div>
  );
}
