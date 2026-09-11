import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faComments, faUser, faLock, faRightToBracket, faShieldHalved, faRotate,
  faClock, faCheck, faXmark, faLink, faHashtag, faAt, faCodeBranch,
  faPaperPlane, faPlay, faSignal, faEnvelope,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { applyLogin } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/swal";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import type { MaintenanceLinkIcon, MaintenanceStatus } from "./useMaintenance";
import "./MaintenancePage.scss";

/**
 * The footer links carry an icon *key*, never a class name: the app imports
 * FontAwesome icons individually (no CSS kit), so the client decides what each
 * key draws. Brand marks are stood in for with solid icons, the same way the
 * profile fields do it — a brands pack is not worth the bundle for nine links.
 */
const LINK_ICONS: Record<MaintenanceLinkIcon, IconDefinition> = {
  link:     faLink,
  discord:  faHashtag,
  x:        faAt,
  github:   faCodeBranch,
  mastodon: faComments,
  telegram: faPaperPlane,
  youtube:  faPlay,
  status:   faSignal,
  email:    faEnvelope,
};

const pad = (n: number) => String(n).padStart(2, "0");

interface Props {
  status: MaintenanceStatus;
  /** True when a user is signed in but their account can't bypass maintenance. */
  blocked: boolean;
  onSignedIn: () => void;
}

export function MaintenancePage({ status, blocked, onSignedIn }: Props) {
  const { t } = useTranslation("common");
  const { data: siteConfig } = useSiteConfig();
  const [signInOpen, setSignInOpen] = useState(false);

  const etaMs = useMemo(() => {
    if (!status.eta) return null;
    const ms = new Date(status.eta).getTime();
    return Number.isNaN(ms) ? null : ms;
  }, [status.eta]);

  // One-second tick, only while there is a countdown left to draw.
  const [now, setNow] = useState(() => Date.now());
  const countdownWanted = status.countdown && etaMs !== null;
  useEffect(() => {
    if (!countdownWanted) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [countdownWanted]);

  const left = etaMs !== null ? Math.max(0, etaMs - now) : 0;
  const showCountdown = countdownWanted && left > 0;
  const backOnline = etaMs !== null
    ? new Date(etaMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const { mode, steps, currentStep, label, percent } = status.progress;
  const showSteps = mode === "steps" && steps.length > 0;
  const showBar   = mode === "bar" && percent > 0;
  // A locked-out account always gets a way in, even with the footer link hidden.
  const showStaffLink = status.staffLink || blocked;

  return (
    <main className={`mt mt--bg-${status.background}`}>
      <div className="mt__bg" aria-hidden="true" />

      <div className="mt__wrap">
        <div className="mt__brand">
          <span className="mt__logomark"><FontAwesomeIcon icon={faComments} /></span>
          <span className="mt__wordmark">{siteConfig?.siteName || "Nodevo"}</span>
        </div>

        <section className="mt-card">
          <div className="mt-card__top">
            <span className="mt-badge"><i />{t("maintenance.badge")}</span>
            {status.autoRefresh && (
              <span className="mt-selfupdate">
                <FontAwesomeIcon icon={faRotate} />{t("maintenance.autoUpdates")}
              </span>
            )}
          </div>

          <h1 className="mt-card__title">{status.title}</h1>
          <p className="mt-card__lead">{status.message}</p>

          {showCountdown && (
            <div className="mt-countdown">
              <div className="mt-countdown__grid">
                <div className="mt-cd">
                  <div className="mt-cd__n">{pad(Math.floor(left / 3_600_000))}</div>
                  <div className="mt-cd__l">{t("maintenance.hours")}</div>
                </div>
                <div className="mt-cd">
                  <div className="mt-cd__n">{pad(Math.floor(left / 60_000) % 60)}</div>
                  <div className="mt-cd__l">{t("maintenance.minutes")}</div>
                </div>
                <div className="mt-cd mt-cd--sec">
                  <div className="mt-cd__n">{pad(Math.floor(left / 1000) % 60)}</div>
                  <div className="mt-cd__l">{t("maintenance.seconds")}</div>
                </div>
              </div>
              {backOnline && (
                <div className="mt-countdown__eta">
                  <FontAwesomeIcon icon={faClock} />
                  {t("maintenance.backOnlineAround", { time: backOnline })}
                </div>
              )}
            </div>
          )}

          {showSteps && (
            <div className="mt-block">
              <div className="mt-block__head">
                <span className="mt-block__title">{t("maintenance.whatWereDoing")}</span>
                <span className="mt-block__aside">
                  {t("maintenance.stepCaption", { current: currentStep, total: steps.length })}
                </span>
              </div>
              <ol className="mt-steps">
                {steps.map((name, i) => {
                  const n = i + 1;
                  const state = n < currentStep ? "done" : n === currentStep ? "current" : "todo";
                  return (
                    <li key={`${n}-${name}`} className={`mt-step is-${state}`}>
                      {n < steps.length && <span className="mt-step__line" aria-hidden="true" />}
                      <span className="mt-step__dot">
                        {state === "done" && <FontAwesomeIcon icon={faCheck} />}
                        {state === "current" && <span className="mt-step__pip" />}
                      </span>
                      <span className="mt-step__name">{name}</span>
                      <span className="mt-step__state">
                        {state === "current" ? t("maintenance.stepInProgress")
                          : state === "done" ? t("maintenance.stepDone")
                          : t("maintenance.stepQueued")}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {showBar && (
            <div className="mt-block mt-block--bar">
              <div className="mt-bar"><div className="mt-bar__fill" style={{ width: `${percent}%` }} /></div>
              <div className="mt-bar__meta">
                <span className="mt-bar__label">{label}</span>
                <span className="mt-bar__pct">{percent}%</span>
              </div>
            </div>
          )}

          {status.services.length > 0 && (
            <div className="mt-block">
              <div className="mt-block__title">{t("maintenance.affectedServices")}</div>
              <ul className="mt-svcs">
                {status.services.map((s, i) => (
                  <li key={`${i}-${s.name}`} className="mt-svc">
                    <span className="mt-svc__name">{s.name}</span>
                    <span className={`mt-svc__state is-${s.status}`}>
                      <i />{t(`maintenance.service.${s.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked && <div className="mt-notice">{t("maintenance.notAuthorized")}</div>}

          {(status.links.length > 0 || showStaffLink) && (
            <div className="mt-card__foot">
              {status.links.length > 0 && (
                <div className="mt-links">
                  <span className="mt-links__label">{t("maintenance.updatesLabel")}</span>
                  {status.links.map((l, i) => (
                    <a
                      key={`${i}-${l.url}`}
                      className="mt-links__a"
                      href={l.url}
                      title={l.label || undefined}
                      aria-label={l.label || l.icon}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FontAwesomeIcon icon={LINK_ICONS[l.icon] ?? faLink} />
                    </a>
                  ))}
                </div>
              )}
              {showStaffLink && (
                <button type="button" className="mt-stafflink" onClick={() => setSignInOpen(true)}>
                  <FontAwesomeIcon icon={faLock} />{t("maintenance.staffSignIn")}
                </button>
              )}
            </div>
          )}
        </section>

        {status.autoRefresh && <p className="mt__note">{t("maintenance.autoRefreshNote")}</p>}
      </div>

      {signInOpen && (
        <StaffSignInDialog onClose={() => setSignInOpen(false)} onSignedIn={onSignedIn} />
      )}
    </main>
  );
}

/** Staff sign-in, in the app's own dialog shell. Kept out of the page body so
 *  the maintenance screen reads as a status page first and a login second. */
function StaffSignInDialog({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const { t } = useTranslation("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [requiresPin, setRequiresPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { email, password };
      if (requiresPin) body.loginPin = pin;
      const res = await api.post<{ accessToken?: string; requiresPin?: boolean }>("/auth/login", body);
      if (res.requiresPin) {
        setRequiresPin(true);
        setLoading(false);
        return;
      }
      await applyLogin(res.accessToken!);
      onSignedIn();
    } catch (err) {
      setError(apiErrorMessage(err, t("maintenance.signInError")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mt-scrim" onClick={onClose} />
      <div className="mt-modal" role="dialog" aria-modal="true" aria-label={t("maintenance.teamAccess")}>
        <section className="mt-login">
          <button type="button" className="mt-login__x" onClick={onClose} aria-label={t("actions.close")}>
            <FontAwesomeIcon icon={faXmark} />
          </button>

          <div className="mt-login__head">
            <div className="mt-login__logo"><FontAwesomeIcon icon={faShieldHalved} /></div>
            <h2>{t("maintenance.teamAccess")}</h2>
            <p>{t("maintenance.signInToBypass")}</p>
          </div>

          {error && <div className="mt-notice mt-notice--error">{error}</div>}

          <form onSubmit={submit}>
            <div className="mt-field">
              <label htmlFor="mtEmail">{t("maintenance.email")}</label>
              <div className="mt-inputwrap">
                <FontAwesomeIcon className="ic" icon={faUser} />
                <input id="mtEmail" type="email" autoComplete="username" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("maintenance.emailPlaceholder")} />
              </div>
            </div>
            <div className="mt-field">
              <label htmlFor="mtPass">{t("maintenance.password")}</label>
              <div className="mt-inputwrap">
                <FontAwesomeIcon className="ic" icon={faLock} />
                <input id="mtPass" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            {requiresPin && (
              <div className="mt-field">
                <label htmlFor="mtPin">{t("maintenance.pin")}</label>
                <div className="mt-inputwrap">
                  <FontAwesomeIcon className="ic" icon={faLock} />
                  <input id="mtPin" inputMode="numeric" maxLength={4} required
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
                </div>
              </div>
            )}
            <button className="mt-btn" type="submit" disabled={loading}>
              <FontAwesomeIcon icon={faRightToBracket} />
              {loading ? t("maintenance.signingIn") : t("maintenance.signIn")}
            </button>
          </form>

          <div className="mt-login__foot">
            <span><FontAwesomeIcon icon={faLock} />{t("maintenance.authorizedOnly")}</span>
            <button type="button" onClick={onClose}>{t("actions.cancel")}</button>
          </div>
        </section>
      </div>
    </>
  );
}
