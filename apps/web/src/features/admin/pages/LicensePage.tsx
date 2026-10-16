import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faKey, faRotate, faCircleExclamation, faPlug, faLinkSlash, faShieldHalved,
  faTriangleExclamation, faCloudArrowDown, faChevronDown, faCopy, faCheck,
  faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";
import { OwnedLicenses, rowIsLive, type OwnedLicense } from "../components/OwnedLicenses";
import "./LicensePage.scss";
import { siteTime } from "../../../lib/datetime";

/** The install's stored entitlement DOCUMENT (`xcf_entitlements`), not a licence.
 *  The marketplace issues one on every activation, including for an account that
 *  owns nothing — which is why the hero below reads its GRANTS rather than its
 *  existence. */
interface License {
  id:             string;
  licenseRef:     string;
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
  /** Where the admin gets a connect code. Served, not guessed: the marketplace
   *  host is a per-deployment setting, so a URL built in the browser would only
   *  be right for installs pointed at the default one. */
  accountUrl:  string;
  licencesUrl: string;
}

/** An in-flight one-click handshake. The poll secret is deliberately absent —
 *  it is the credential that claims the account token and never leaves the
 *  server; the browser only ever holds the id, the code and the URL. */
interface LinkStart {
  linkId:       string;
  userCode:     string;
  approveUrl:   string;
  expiresAt:    string;
  pollInterval: number;
}

interface LinkStatus {
  status: "pending" | "approved" | "denied" | "expired";
}

/** Grants are signed as objects (`{id, updatesUntil?}`) — see EntitlementGrant.
 *  Only the ids are wanted here. */
function parseEntitlements(jwt: string): string[] {
  try {
    const grants = JSON.parse(atob(jwt.split(".")[1]!)).entitlements ?? [];
    return grants.map((g: any) => (typeof g === "string" ? g : g?.id)).filter(Boolean);
  } catch { return []; }
}

const fmtDate = (iso: string) => siteTime.date(iso);

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
  const [link, setLink] = useState<LinkStart | null>(null);

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

  const onConnected = () => {
    qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] });
    // Connecting activates every licence the account holds, so the two views of
    // that — the stored entitlement and the ownership table — are both stale
    // the moment it succeeds.
    qc.invalidateQueries({ queryKey: ["acp-license"] });
    qc.invalidateQueries({ queryKey: ["acp-marketplace-owned"] });
    setConnectError(null);
    swalToast(t("license.toastConnected"), "success");
  };

  const connectMut = useMutation({
    mutationFn: () => api.post("/admin/marketplace/connection", { authCode: authCode.trim() }),
    onSuccess:  () => { setAuthCode(""); onConnected(); },
    onError:    (e: any) => setConnectError(e?.data?.message ?? apiErrorMessage(e)),
  });

  /**
   * The one-click handshake.
   *
   * Start it, open the marketplace in a new tab, and poll until the account
   * holder decides. The code is shown here so it can be compared against the
   * one on the approval screen — that comparison is what makes an approval link
   * safe to click, so it is displayed prominently rather than tucked away.
   */
  const linkMut = useMutation<LinkStart>({
    mutationFn: () => api.post("/admin/marketplace/link", {}),
    onSuccess:  (started) => {
      setLink(started);
      setConnectError(null);
      // Opened from the click's own handler chain, so it is not treated as a
      // popup. If the browser blocks it anyway the URL is on screen as a link.
      window.open(started.approveUrl, "_blank", "noopener,noreferrer");
    },
    onError:    (e: any) => setConnectError(e?.data?.message ?? apiErrorMessage(e)),
  });

  const linkPoll = useQuery<LinkStatus>({
    queryKey: ["acp-marketplace-link", link?.linkId],
    queryFn:  () => api.get(`/admin/marketplace/link/${link!.linkId}`),
    enabled:  !!link && !connected,
    // The marketplace names the cadence; honouring it keeps every install in
    // the field on one budget rather than on whatever each client felt like.
    refetchInterval: (link?.pollInterval ?? 3) * 1000,
    // A poll is a question about someone else's decision — retrying a failed
    // one silently would hide a dead handshake behind an interval that never
    // ends.
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    const status = linkPoll.data?.status;
    if (!status || status === "pending") return;

    setLink(null);
    if (status === "approved") { onConnected(); return; }
    setConnectError(t(status === "denied" ? "license.linkDenied" : "license.linkExpired"));
    // Keyed on the STATUS alone: `onConnected` is rebuilt every render, and
    // depending on it would re-run this on every paint while a poll is live.
  }, [linkPoll.data?.status]);

  // A handshake that errors out (the instance restarted, the marketplace went
  // away) must not leave the panel waiting on a poll that will never answer.
  useEffect(() => {
    if (!linkPoll.error) return;
    setLink(null);
    setConnectError(apiErrorMessage(linkPoll.error));
  }, [linkPoll.error]);

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
    // Connected, holding a signed entitlement, and it grants NOTHING.
    //
    // This is the ordinary state of an account that has registered and linked
    // but not bought anything, and it used to fall through to the green
    // "Licensed until <date> · Active" below — because a `license` row exists
    // the moment an account connects. Connecting is not buying: the row is the
    // signed document, and an empty document is not a licence. Saying otherwise
    // told a brand-new account it was licensed for a month, next to a table
    // reading "this account doesn't own anything yet".
    if (entitlements.length === 0) return {
      tone: "subtle" as Tone, icon: faKey,
      badge:    t("license.hero.badgeNoLicences"),
      headline: t("license.hero.noLicencesHeadline"),
      sub:      t("license.hero.noLicencesSub"),
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
    [t("license.fieldKey"),          license.licenseRef],
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
                      style={{ marginLeft: 7, fontSize: "var(--fs-2xs)", transition: "transform .2s", transform: `rotate(${detailsOpen ? 180 : 0}deg)` }}
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
                <button type="button" className="btn-ghost-danger" onClick={handleDisconnect} disabled={disconnectMut.isPending}>
                  <FontAwesomeIcon icon={faLinkSlash} style={{ marginRight: 6 }} />
                  {t("license.disconnect")}
                </button>
              </div>
            ) : link ? (
              /* Waiting on the human. The code is the point of this state: it is
                 the only thing that lets the person on the approval screen know
                 the request came from HERE and not from a link somebody sent
                 them. */
              <div className="lic-rail__stack">
                <div className="lic-link">
                  <div className="lic-link__label">{t("license.linkCodeLabel")}</div>
                  <div className="lic-link__code">{link.userCode}</div>
                </div>
                <div className="lic-link__waiting">
                  <FontAwesomeIcon icon={faRotate} spin style={{ marginRight: 7 }} />
                  {t("license.linkWaiting")}
                </div>
                <a className="lic-rail__link" href={link.approveUrl} target="_blank" rel="noreferrer noopener">
                  {t("license.linkReopen")}
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginLeft: 5, fontSize: "0.85em" }} />
                </a>
                <button type="button" className="btn-ghost" onClick={() => setLink(null)}>
                  {t("license.linkCancel")}
                </button>
              </div>
            ) : (
              <div className="lic-rail__stack">
                <button type="button" className="btn-primary" disabled={linkMut.isPending} onClick={() => linkMut.mutate()}>
                  <FontAwesomeIcon icon={faPlug} style={{ marginRight: 6 }} />
                  {linkMut.isPending ? t("license.connecting") : t("license.linkConnect")}
                </button>

                {/* The typed code still works, and has to: an install whose
                    admin cannot open a browser tab from this machine — a
                    headless box, a locked-down network — has no other way in.
                    It is second because it is the harder path, not because it
                    is deprecated. */}
                <details className="lic-link__manual">
                  <summary>{t("license.linkManual")}</summary>
                  <div className="lic-rail__hint" style={{ marginBottom: 8 }}>
                    {t("license.connectHint")}{" "}
                    <a href={conn?.accountUrl ?? "#"} target="_blank" rel="noreferrer noopener" className="lic-rail__link">
                      {t("license.connectHintLink")}
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginLeft: 5, fontSize: "0.85em" }} />
                    </a>
                  </div>
                  <input
                    className="acp-input"
                    value={authCode}
                    onChange={(e) => { setAuthCode(e.target.value); setConnectError(null); }}
                    placeholder={t("license.authPlaceholder")}
                    onKeyDown={(e) => { if (e.key === "Enter" && authCode.trim()) connectMut.mutate(); }}
                  />
                  <button type="button" className="btn-ghost" disabled={!authCode.trim() || connectMut.isPending} onClick={() => connectMut.mutate()}>
                    {connectMut.isPending ? t("license.connecting") : t("license.connect")}
                  </button>
                </details>
                {connectError ? (
                  <div className="lic-hint" style={{ marginTop: 0, background: "var(--c-danger-soft)", border: "1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)", color: "var(--c-danger)" }}>
                    <FontAwesomeIcon icon={faCircleExclamation} />
                    <span>{connectError}</span>
                  </div>
                ) : (
                  <div className="lic-rail__hint">{t("license.linkHint")}</div>
                )}
              </div>
            )}
          </section>

          {/* Only when the document actually grants something. "Signed until /
              Grants 0 / Next check" is the paperwork's own metadata, and shown
              to an account that has just linked and bought nothing it reads as
              though a licence were in force — the same impression the hero used
              to give. An empty card is not neutral here; it is a claim. */}
          {license && entitlements.length > 0 && (
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
