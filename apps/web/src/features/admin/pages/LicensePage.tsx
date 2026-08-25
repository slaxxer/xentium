import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faKey, faRotate, faCircleExclamation, faPlug, faLinkSlash, faShieldHalved,
  faTriangleExclamation, faCloudArrowDown, faChevronDown, faCopy, faCheck,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";
import { OwnedLicenses, rowIsLive, type OwnedLicense } from "../components/OwnedLicenses";
import "./LicensePage.scss";

interface License {
  id:             string;
  licenseKey:     string;
  siteId:         string;
  status:         string;
  domain:         string | null;
  environment:    string | null;
  activatedAt:    string;
  expiresAt:      string | null;
  refreshAfter:   string | null;
  entitlementJwt: string;
}

interface MarketplaceConnection {
  sourceId:    string;
  connected:   boolean;
  accountRef:  string | null;
  connectedAt: string | null;
}

/** Grants are signed as objects (`{id, updatesUntil?}`) — see EntitlementGrant.
 *  Only the ids are wanted here. */
function parseEntitlements(jwt: string): string[] {
  try {
    const grants = JSON.parse(atob(jwt.split(".")[1]!)).entitlements ?? [];
    return grants.map((g: any) => (typeof g === "string" ? g : g?.id)).filter(Boolean);
  } catch { return []; }
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Warn this many days out. Matches the expiry dialog's own threshold so the
 *  page and the nag cannot disagree about what "soon" means. */
const EXPIRY_WARN_DAYS = 14;

type Tone = "success" | "warn" | "danger" | "subtle";

const TONE_VAR: Record<Tone, string> = {
  success: "var(--c-success)",
  warn:    "var(--c-warn)",
  danger:  "var(--c-danger)",
  subtle:  "var(--c-fg-subtle)",
};

/** `color-mix` over the token rather than a second hardcoded tint, so a themed
 *  --c-success carries its own soft fill with it. */
const soft = (tone: Tone, pct: number) =>
  `color-mix(in srgb, ${TONE_VAR[tone]} ${pct}%, transparent)`;

export function LicensePage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [authCode, setAuthCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: license, isLoading } = useQuery<License | null>({
    queryKey: ["acp-license"],
    queryFn:  () => api.get("/admin/license"),
  });

  const { data: conn } = useQuery<MarketplaceConnection>({
    queryKey: ["acp-marketplace-connection"],
    queryFn:  () => api.get("/admin/marketplace/connection"),
  });

  const connected = !!conn?.connected;

  // Hoisted out of OwnedLicenses so the hero, the table and the rail all read
  // ONE fetch. When they each had their own, "marketplace unreachable" could be
  // true for the table and false for the banner above it.
  const owned = useQuery<{ licenses: OwnedLicense[] }>({
    queryKey: ["acp-marketplace-owned"],
    queryFn:  () => api.get("/admin/marketplace/owned"),
    enabled:  connected,
  });

  const connectMut = useMutation({
    mutationFn: () => api.post("/admin/marketplace/connection", { authCode: authCode.trim() }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] }); setAuthCode(""); setConnectError(null); swalToast(t("license.toastConnected"), "success"); },
    onError:    (e: any) => setConnectError(e?.data?.message ?? apiErrorMessage(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.delete("/admin/marketplace/connection"),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] });
      // Disconnecting deactivates account-activated licenses server-side.
      qc.invalidateQueries({ queryKey: ["acp-license"] });
      swalToast(t("license.toastDisconnected"), "success");
    },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const handleDisconnect = async () => {
    const ok = await swalConfirm(
      t("license.disconnectTitle"),
      t("license.disconnectText"),
      t("license.disconnect"),
    );
    if (ok) disconnectMut.mutate();
  };

  const refreshMut = useMutation({
    mutationFn: () => api.post("/admin/license/refresh", {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["acp-license"] });
      // A refresh is the one moment a just-bought licence appears, so the table
      // has to be re-asked too — that is the whole reason to press the button.
      qc.invalidateQueries({ queryKey: ["acp-marketplace-owned"] });
      swalToast(t("license.toastRefreshed"), "success");
    },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
  };

  const entitlements = license ? parseEntitlements(license.entitlementJwt) : [];
  const licenses = owned.data?.licenses ?? [];
  const offline = connected && !!owned.error;

  const expiresAt = license?.expiresAt ? new Date(license.expiresAt) : null;
  const daysLeft = expiresAt
    ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)
    : null;
  const isExpired = !!license && (license.status === "expired" || (daysLeft !== null && daysLeft < 0));

  /** Five hero states. Row-level states (no seat, updates lapsed, not installed)
   *  belong to the table — the hero speaks only for the install as a whole. */
  const hero = (() => {
    if (!connected) return {
      tone: "subtle" as Tone, icon: faKey,
      badge:    t("license.hero.badgeUnlicensed"),
      headline: t("license.hero.disconnectedHeadline"),
      sub:      t("license.hero.disconnectedSub"),
      hint:     null as string | null,
    };
    if (!license) return {
      tone: "subtle" as Tone, icon: faKey,
      badge:    t("license.hero.badgeUnlicensed"),
      headline: t("license.noLicenseTitle"),
      sub:      t("license.noLicenseHint"),
      hint:     null as string | null,
    };
    if (isExpired) return {
      tone: "danger" as Tone, icon: faCircleExclamation,
      badge:    t("license.hero.badgeExpired"),
      headline: expiresAt ? t("license.hero.expiredHeadline", { date: fmtDate(license.expiresAt!) }) : t("license.hero.expiredHeadlineBare"),
      sub:      t("license.hero.expiredSub"),
      hint:     t("license.hero.expiredHint"),
    };
    if (offline) return {
      tone: "warn" as Tone, icon: faCloudArrowDown,
      badge:    t("license.hero.badgeLastKnown"),
      headline: expiresAt ? t("license.hero.activeHeadline", { date: fmtDate(license.expiresAt!) }) : t("license.hero.activeHeadlineBare"),
      sub:      t("license.hero.activatedOn", { date: fmtDate(license.activatedAt) }),
      hint:     t("license.hero.offlineHint"),
    };
    if (daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS) return {
      tone: "warn" as Tone, icon: faTriangleExclamation,
      badge:    t("license.hero.badgeDays", { count: daysLeft }),
      headline: t("license.hero.expiringHeadline", { date: fmtDate(license.expiresAt!) }),
      sub:      t("license.hero.activatedOn", { date: fmtDate(license.activatedAt) }),
      hint:     t("license.hero.expiringHint"),
    };
    return {
      tone: "success" as Tone, icon: faShieldHalved,
      badge:    t("license.hero.badgeActive"),
      headline: expiresAt ? t("license.hero.activeHeadline", { date: fmtDate(license.expiresAt!) }) : t("license.hero.activeHeadlineBare"),
      sub:      t("license.hero.activeSub", { date: fmtDate(license.activatedAt) }),
      hint:     null as string | null,
    };
  })();

  const techFields: [string, string][] = license ? [
    [t("license.fieldKey"),          license.licenseKey],
    [t("license.fieldSiteId"),       license.siteId],
    [t("license.fieldActivated"),    fmtDate(license.activatedAt)],
    [t("license.fieldRefreshAfter"), license.refreshAfter ? fmtDate(license.refreshAfter) : "—"],
  ] : [];

  const liveCount = licenses.filter((l) => rowIsLive(l, isExpired)).length;

  return (
    <div className="lic-page">
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("nav.license")}</h1>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
          <FontAwesomeIcon icon={faRotate} spin={refreshMut.isPending} style={{ marginRight: 6 }} />
          {refreshMut.isPending ? t("license.refreshing") : t("license.refresh")}
        </button>
      </div>

      <ExtensionsUpdateBanner />

      <div className="lic-grid">
        <div className="lic-col">

          {/* ── Status hero ─────────────────────────────────────────────── */}
          <section className="lic-card">
            <div className="lic-hero">
              <div className="lic-hero__icon" style={{ background: soft(hero.tone, 12), color: TONE_VAR[hero.tone] }}>
                <FontAwesomeIcon icon={hero.icon} />
              </div>
              <div className="lic-hero__body">
                <div className="lic-hero__line">
                  <div className="lic-hero__headline">{hero.headline}</div>
                  <span className="lic-hero__badge" style={{ background: soft(hero.tone, 12), color: TONE_VAR[hero.tone] }}>
                    {hero.badge}
                  </span>
                </div>
                <div className="lic-hero__sub">{hero.sub}</div>
                {hero.hint && (
                  <div className="lic-hint" style={{ background: soft(hero.tone, 9), border: `1px solid ${soft(hero.tone, 28)}`, color: TONE_VAR[hero.tone] }}>
                    <FontAwesomeIcon icon={faCircleExclamation} />
                    <span>{hero.hint}</span>
                  </div>
                )}
              </div>
            </div>

            {isLoading ? null : license ? (
              <>
                <div className="lic-meta">
                  <div className="lic-meta__item">
                    <span className="lic-meta__label">{t("license.fieldDomain")}</span>
                    <span className="lic-meta__value">{license.domain ?? "—"}</span>
                  </div>
                  <span className="lic-meta__rule" />
                  <div className="lic-meta__item">
                    <span className="lic-meta__label">{t("license.fieldEnvironment")}</span>
                    <span className="lic-meta__value">{license.environment ?? "—"}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-sm lic-meta__toggle"
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((o) => !o)}
                  >
                    {detailsOpen ? t("license.hideDetails") : t("license.showDetails")}
                    <FontAwesomeIcon
                      icon={faChevronDown}
                      style={{ marginLeft: 7, fontSize: 10, transition: "transform .2s", transform: `rotate(${detailsOpen ? 180 : 0}deg)` }}
                    />
                  </button>
                </div>

                {detailsOpen && (
                  <div className="lic-tech">
                    <div className="lic-tech__label">{t("license.technical")}</div>
                    <div className="lic-tech__grid">
                      {techFields.map(([label, value]) => (
                        <div className="lic-field" key={label}>
                          <div className="lic-field__body">
                            <div className="lic-field__label">{label}</div>
                            <div className="lic-field__value">{value}</div>
                          </div>
                          <button
                            type="button"
                            className={`lic-copy${copied === label ? " is-copied" : ""}`}
                            title={t("license.copy")}
                            aria-label={t("license.copy")}
                            onClick={() => copy(label, value)}
                          >
                            <FontAwesomeIcon icon={copied === label ? faCheck : faCopy} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : connected && (
              <div className="lic-meta">
                <button type="button" className="btn-primary btn-sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                  <FontAwesomeIcon icon={faRotate} spin={refreshMut.isPending} style={{ marginRight: 6 }} />
                  {refreshMut.isPending ? t("license.refreshing") : t("license.activateFromAccount")}
                </button>
              </div>
            )}
          </section>

          {/* ── Licences & entitlements ─────────────────────────────────── */}
          <OwnedLicenses
            connected={connected}
            licenses={licenses}
            isLoading={owned.isLoading}
            unreachable={offline}
            expired={isExpired}
            liveCount={liveCount}
            onChanged={() => {
              void qc.invalidateQueries({ queryKey: ["acp-marketplace-owned"] });
              void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
            }}
          />
        </div>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside className="lic-col">
          <section className="lic-rail__card">
            <div className="lic-rail__title">
              <FontAwesomeIcon icon={faPlug} />
              {t("license.accountTitle")}
            </div>
            <div className="lic-rail__conn" style={{ color: connected ? "var(--c-success)" : "var(--c-fg-subtle)" }}>
              <span className="lic-rail__dot" style={{ background: connected ? "var(--c-success)" : "var(--c-fg-subtle)" }} />
              {connected ? t("license.connectedBadge") : t("license.notConnectedBadge")}
            </div>
            <div className="lic-rail__desc">{t("license.accountDesc")}</div>

            {connected ? (
              <div className="lic-rail__stack">
                <div className="lic-rail__field">
                  <div className="lic-field__label">{t("license.fieldAccount")}</div>
                  <div className="lic-field__value">{conn?.accountRef ?? "—"}</div>
                </div>
                <div className="lic-rail__field">
                  <div className="lic-field__label">{t("license.fieldConnected")}</div>
                  <div className="lic-field__value" style={{ fontFamily: "inherit" }}>
                    {conn?.connectedAt ? fmtDate(conn.connectedAt) : "—"}
                  </div>
                </div>
                <button type="button" className="btn-ghost-danger btn-sm" onClick={handleDisconnect} disabled={disconnectMut.isPending}>
                  <FontAwesomeIcon icon={faLinkSlash} style={{ marginRight: 6 }} />
                  {t("license.disconnect")}
                </button>
              </div>
            ) : (
              <div className="lic-rail__stack">
                <input
                  className="acp-input"
                  value={authCode}
                  onChange={(e) => { setAuthCode(e.target.value); setConnectError(null); }}
                  placeholder={t("license.authPlaceholder")}
                  onKeyDown={(e) => { if (e.key === "Enter" && authCode.trim()) connectMut.mutate(); }}
                />
                <button type="button" className="btn-primary btn-sm" disabled={!authCode.trim() || connectMut.isPending} onClick={() => connectMut.mutate()}>
                  <FontAwesomeIcon icon={faPlug} style={{ marginRight: 6 }} />
                  {connectMut.isPending ? t("license.connecting") : t("license.connect")}
                </button>
                {connectError ? (
                  <div className="lic-hint" style={{ marginTop: 0, background: "var(--c-danger-soft)", border: "1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)", color: "var(--c-danger)" }}>
                    <FontAwesomeIcon icon={faCircleExclamation} />
                    <span>{connectError}</span>
                  </div>
                ) : (
                  <div className="lic-rail__hint">{t("license.connectHint")}</div>
                )}
              </div>
            )}
          </section>

          {license && (
            <section className="lic-rail__card">
              <div className="lic-rail__eyebrow">{t("license.entitlements")}</div>
              <dl className="lic-rail__rows">
                <div className="lic-rail__row">
                  <dt>{t("license.railSignedUntil")}</dt>
                  <dd>{license.expiresAt ? fmtDate(license.expiresAt) : "—"}</dd>
                </div>
                <div className="lic-rail__row">
                  <dt>{t("license.railGrants")}</dt>
                  <dd>{entitlements.length}</dd>
                </div>
                <div className="lic-rail__row">
                  <dt>{t("license.railNextCheck")}</dt>
                  <dd>{license.refreshAfter ? fmtDate(license.refreshAfter) : "—"}</dd>
                </div>
              </dl>
              <div className="lic-rail__rule" />
              <div className="lic-rail__note">{t("license.railNote")}</div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
