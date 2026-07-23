import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth, applyLogin } from "../../hooks/useAuth";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import { api } from "../../lib/api";
import { swalToast } from "../../lib/swal";
import { toast } from "../../lib/toast";
import { openDialog } from "../../lib/dialog";
import "./LoginPage.scss";

/** Only allow returning to in-app relative paths to prevent open-redirect. */
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.split("").concat(["", "", "", ""]).slice(0, 4);

  function onInput(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const char = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = char;
    onChange(next.join(""));
    if (char && i < 3) refs.current[i + 1]?.focus();
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  }

  return (
    <div className="lp-pin-input">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKey(i, e)}
          autoComplete="off"
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation("auth");
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const { data: siteConfig } = useSiteConfig();
  const loginMethod = siteConfig?.auth?.loginMethod ?? "email";
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [pin, setPin]             = useState("");
  const [requiresPin, setRequiresPin] = useState(false);
  const [loading, setLoading]     = useState(false);

  if (isAuthenticated) return <Navigate to={returnTo} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body: Record<string, unknown> = { identifier: email, password };
      if (requiresPin) body.loginPin = pin;

      const res = await api.post<{ accessToken?: string; requiresPin?: boolean }>("/auth/login", body);

      if (res.requiresPin) {
        setRequiresPin(true);
        setPin("");
        return;
      }

      await applyLogin(res.accessToken!);
      navigate(returnTo);
    } catch (err: any) {
      // All API errors are the canonical `{ error: { code, message, details } }`.
      const errObj = err?.detail?.error;
      const code = errObj?.code;

      if (code === "NEC-AUTH-1003" || code === "NEC-AUTH-1004") {
        const reason    = (errObj?.details?.reason as string) ?? "Account suspended";
        const expiresAt = errObj?.details?.expiresAt as string | null;
        const expiry    = expiresAt
          ? new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
          : null;
        toast.error(`${t("login.banReason")}: ${reason}`, {
          title:    expiry ? t("login.bannedUntil", { date: expiry }) : t("login.bannedPermanent"),
          duration: 7000,
        });
      } else if (code === "NEC-AUTH-1032") {
        openDialog({
          kind:  "alert", icon: "error",
          title: t("login.accessDenied"),
          body:  t("login.betaIpLocked"),
        });
      } else if (code === "NEC-AUTH-1030") {
        swalToast(t("login.betaRequired"), "warning");
      } else if (code === "NEC-AUTH-1040") {
        // Failed-login lockout — surface the server message (carries the retry window).
        swalToast(errObj?.message ?? err?.message ?? t("login.lockedOut"), "warning");
      } else {
        swalToast(
          code === "NEC-AUTH-1001" ? t("login.invalidCredentials")
          : requiresPin                  ? t("pin.wrong")
          : t("login.signInFailed"),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const leftPanel = (
    <div className="aurora-split__left">
      <div className="aurora-split__glow" />
      <div className="aurora-split__brand">
        <Link to="/" className="aurora-split__logo">
          <div className="aurora-split__logo-mark"><span /></div>
          <span className="aurora-split__wordmark">nodevo</span>
        </Link>
        <h2 className="aurora-split__tagline">{t("login.panelTagline")}</h2>
        <p className="aurora-split__subtitle">
          {t("login.panelSubtitle")}
        </p>
        <ul className="aurora-split__features">
          <li className="aurora-split__feature"><span className="aurora-split__feature-dot" />{t("login.feature1")}</li>
          <li className="aurora-split__feature"><span className="aurora-split__feature-dot" />{t("login.feature2")}</li>
          <li className="aurora-split__feature"><span className="aurora-split__feature-dot" />{t("login.feature3")}</li>
          <li className="aurora-split__feature"><span className="aurora-split__feature-dot" />{t("login.feature4")}</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="aurora-split">
      {leftPanel}

      <div className="aurora-split__right">
        <div className="aurora-split__form-wrap">

          {!requiresPin ? (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("login.title")}</h1>
                <p className="auth-header__sub">{t("login.subtitle")}</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="login-field">
                  <label className="login-label" htmlFor="login-email">
                    {loginMethod === "username" ? t("login.username")
                      : loginMethod === "either" ? t("login.identifier")
                      : t("login.email")}
                  </label>
                  <input
                    id="login-email"
                    className="login-input"
                    type={loginMethod === "email" ? "email" : "text"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete={loginMethod === "email" ? "email" : "username"}
                  />
                </div>
                <div className="login-field">
                  <label className="login-label" htmlFor="login-password">{t("login.password")}</label>
                  <input
                    id="login-password"
                    className="login-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <button className="login-submit" type="submit" disabled={loading}>
                  {loading ? t("login.submitting") : t("login.submit")}
                </button>
              </form>
              <p className="login-register">
                <Link to="/forgot-password">{t("login.forgot")}</Link>
              </p>
              <p className="login-register">
                {t("login.noAccount")} <Link to="/register">{t("login.createOne")}</Link>
              </p>
            </>
          ) : (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("pin.title")}</h1>
                <p className="auth-header__sub">{t("pin.subtitle")}</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="login-field">
                  <label className="login-label">{t("pin.label")}</label>
                  <PinInput value={pin} onChange={setPin} />
                </div>
                <button
                  className="login-submit"
                  type="submit"
                  disabled={loading || pin.length < 4}
                >
                  {loading ? t("pin.verifying") : t("pin.continue")}
                </button>
              </form>
              <p className="login-register">
                <button
                  className="lp-back-btn"
                  type="button"
                  onClick={() => { setRequiresPin(false); setPin(""); }}
                >
                  {t("pin.back")}
                </button>
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
