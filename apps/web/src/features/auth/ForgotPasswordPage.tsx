import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import "./LoginPage.scss";

export function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Always 200 — the backend never reveals whether the email exists.
      await api.post("/auth/password-reset", { email });
    } catch {
      /* swallow — never leak account existence */
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  const leftPanel = (
    <div className="aurora-split__left">
      <div className="aurora-split__glow" />
      <div className="aurora-split__brand">
        <Link to="/" className="aurora-split__logo">
          <div className="aurora-split__logo-mark"><span /></div>
          <span className="aurora-split__wordmark">xentium</span>
        </Link>
        <h2 className="aurora-split__tagline">{t("forgot.tagline")}</h2>
        <p className="aurora-split__subtitle">
          {t("forgot.panelSubtitle")}
        </p>
      </div>
    </div>
  );

  return (
    <div className="aurora-split">
      {leftPanel}
      <div className="aurora-split__right">
        <div className="aurora-split__form-wrap">
          {sent ? (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("forgot.sentTitle")}</h1>
                <p className="auth-header__sub">
                  {t("forgot.sentBody", { email })}
                </p>
              </div>
              <p className="login-register">
                <Link to="/login">{t("forgot.backToSignin")}</Link>
              </p>
            </>
          ) : (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("forgot.title")}</h1>
                <p className="auth-header__sub">{t("forgot.lead")}</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="login-field">
                  <label className="login-label" htmlFor="forgot-email">{t("forgot.email")}</label>
                  <input
                    id="forgot-email"
                    className="login-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </div>
                <button className="login-submit" type="submit" disabled={loading}>
                  {loading ? t("forgot.submitting") : t("forgot.submit")}
                </button>
              </form>
              <p className="login-register">
                {t("forgot.remembered")} <Link to="/login">{t("forgot.signIn")}</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
