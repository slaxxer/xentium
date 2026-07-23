import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { swalToast } from "../../lib/swal";
import "./LoginPage.scss";

export function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { swalToast(t("reset.minLength"), "warning"); return; }
    if (password !== confirm) { swalToast(t("reset.mismatch"), "warning"); return; }

    setLoading(true);
    try {
      await api.post("/auth/password-reset/confirm", { token, password });
      setDone(true);
      swalToast(t("reset.success"), "success");
      setTimeout(() => navigate("/login"), 1500);
    } catch (err: any) {
      const code = err?.detail?.error?.code;
      swalToast(
        code === "NEC-AUTH-1007"
          ? t("reset.expired")
          : t("reset.error"),
      );
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
        <h2 className="aurora-split__tagline">{t("reset.tagline")}</h2>
        <p className="aurora-split__subtitle">
          {t("reset.panelSubtitle")}
        </p>
      </div>
    </div>
  );

  return (
    <div className="aurora-split">
      {leftPanel}
      <div className="aurora-split__right">
        <div className="aurora-split__form-wrap">
          {!token ? (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("reset.invalidTitle")}</h1>
                <p className="auth-header__sub">{t("reset.invalidBody")}</p>
              </div>
              <p className="login-register">
                <Link to="/forgot-password">{t("reset.requestNew")}</Link>
              </p>
            </>
          ) : done ? (
            <div className="auth-header">
              <h1 className="auth-header__title">{t("reset.doneTitle")}</h1>
              <p className="auth-header__sub">{t("reset.doneBody")}</p>
            </div>
          ) : (
            <>
              <div className="auth-header">
                <h1 className="auth-header__title">{t("reset.title")}</h1>
                <p className="auth-header__sub">{t("reset.lead")}</p>
              </div>
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="login-field">
                  <label className="login-label" htmlFor="reset-password">{t("reset.newPassword")}</label>
                  <input
                    id="reset-password"
                    className="login-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    autoComplete="new-password"
                    placeholder={t("reset.placeholder")}
                  />
                </div>
                <div className="login-field">
                  <label className="login-label" htmlFor="reset-confirm">{t("reset.confirmPassword")}</label>
                  <input
                    id="reset-confirm"
                    className="login-input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder={t("reset.confirmPlaceholder")}
                  />
                </div>
                <button className="login-submit" type="submit" disabled={loading}>
                  {loading ? t("reset.submitting") : t("reset.submit")}
                </button>
              </form>
              <p className="login-register">
                {t("reset.remembered")} <Link to="/login">{t("reset.signIn")}</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
