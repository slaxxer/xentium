import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments, faUser, faLock, faRightToBracket, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { applyLogin } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/swal";
import type { MaintenanceStatus } from "./useMaintenance";
import "./MaintenancePage.scss";

/** Formats the time between now and the ETA as a coarse "remaining" string. */
function formatRemaining(eta: string | null): string | null {
  if (!eta) return null;
  const ms = new Date(eta).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "any moment";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h} h ${m} min` : `~${h} h`;
}

interface Props {
  status: MaintenanceStatus;
  /** True when a user is signed in but their account can't bypass maintenance. */
  blocked: boolean;
  onSignedIn: () => void;
}

export function MaintenancePage({ status, blocked, onSignedIn }: Props) {
  const { t } = useTranslation("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [requiresPin, setRequiresPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Tick once a minute so the "remaining" countdown stays fresh without a refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const remaining = formatRemaining(status.eta);
  const backOnline = status.eta
    ? new Date(status.eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

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
    <main className="mt">
      <section className="mt-left">
        <span className="mt-brand">
          <span className="mt-logomark"><FontAwesomeIcon icon={faComments} /></span>
          <span className="mt-wordmark">Nodevo</span>
        </span>
        <span className="mt-status"><i />{t("maintenance.badge")}</span>
        <h1 className="mt-h1">{status.title}</h1>
        <p className="mt-lead">{status.message}</p>

        {(remaining || backOnline) && (
          <div className="mt-meta">
            {remaining && (
              <div><div className="mt-meta__n">{remaining}</div><div className="mt-meta__l">{t("maintenance.remaining")}</div></div>
            )}
            {backOnline && (
              <div><div className="mt-meta__n">{backOnline}</div><div className="mt-meta__l">{t("maintenance.backOnline")}</div></div>
            )}
          </div>
        )}

        {status.progress.percent > 0 && (
          <div className="mt-progwrap">
            <div className="mt-prog"><div className="mt-prog__fill" style={{ width: `${status.progress.percent}%` }} /></div>
            <span>{status.progress.label} · {status.progress.percent}%</span>
          </div>
        )}
      </section>

      <section className="mt-right">
        <div className="mt-login">
          <div className="mt-login__head">
            <div className="mt-login__logo"><FontAwesomeIcon icon={faShieldHalved} /></div>
            <h2>{t("maintenance.teamAccess")}</h2>
            <p>{t("maintenance.signInToBypass")}</p>
          </div>

          {blocked && <div className="mt-notice">{t("maintenance.notAuthorized")}</div>}
          {error && <div className="mt-notice mt-notice--error">{error}</div>}

          <form onSubmit={submit}>
            <div className="mt-field">
              <label htmlFor="mtEmail">{t("maintenance.email")}</label>
              <div className="mt-inputwrap">
                <FontAwesomeIcon className="ic" icon={faUser} />
                <input id="mtEmail" type="email" autoComplete="username" required
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
          <div className="mt-login__foot">{t("maintenance.authorizedOnly")}</div>
        </div>
      </section>
    </main>
  );
}
