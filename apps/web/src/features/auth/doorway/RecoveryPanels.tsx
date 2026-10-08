import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faEnvelopeOpenText, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { applyLogin, useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { safeReturnTo } from "../returnTo";
import { AuthDoorway, useAuthMethods } from "./AuthDoorway";
import { apiErr, errorText, pinErrorText } from "./authErrors";
import { DigitsInput, FormError, PasswordInput } from "./pieces";
import { MagicLinkRequest } from "./SignInPanel";
import { completePin, type SignInResponse } from "./signInClient";

/** /forgot-password — a reset link, or a sign-in link instead. */
export function ForgotPanel() {
  const { t } = useTranslation("auth");
  const { data: methods } = useAuthMethods();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkMode, setLinkMode] = useState(false);

  if (linkMode) return <MagicLinkRequest initialEmail={email} remember onBack={() => setLinkMode(false)} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.post("/auth/password-reset", { email: email.trim() });
      setSent(true);
    } catch (err) { setError(errorText(t, apiErr(err))); } finally { setBusy(false); }
  };

  return (
    <AuthDoorway>
      <Link to="/login" className="dw-link dw-back">← {t("door.backToSignIn")}</Link>
      <div className="dw-head">
        <h1>{sent ? t("door.forgot.sentTitle") : t("door.forgot.title")}</h1>
        <p>{sent ? t("door.forgot.sentSub", { email: email.trim() }) : t("door.forgot.sub")}</p>
      </div>
      {!sent ? (
        <form className="dw-form" onSubmit={submit}>
          <label className="dw-field">
            <span className="dw-label">{t("door.email")}</span>
            <input className="dw-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </label>
          <FormError>{error}</FormError>
          <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={busy}>{busy ? t("door.forgot.sending") : t("door.forgot.send")}</button>
        </form>
      ) : (
        <div className="dw-state"><span className="dw-state__icon"><FontAwesomeIcon icon={faEnvelopeOpenText} /></span></div>
      )}
      {methods?.magicLink && !sent && (
        <p className="dw-center dw-muted">
          {t("door.forgot.or")}{" "}
          <button type="button" className="dw-link" onClick={() => setLinkMode(true)}>
            <FontAwesomeIcon icon={faWandMagicSparkles} /> {t("door.forgot.linkInstead")}
          </button>
        </p>
      )}
    </AuthDoorway>
  );
}

/** The PIN step for a ticket that arrived in the URL (after a provider) or from a link. */
function TicketPin({ ticket, onDone }: { ticket: string; onDone: (res: SignInResponse) => Promise<void> }) {
  const { t } = useTranslation("auth");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await onDone(await completePin(ticket, pin)); } catch (err) {
      setError(pinErrorText(t, apiErr(err))); setPin("");
    } finally { setBusy(false); }
  };
  return (
    <AuthDoorway>
      <div className="dw-head">
        <h1>{t("door.pin.title")}</h1>
        <p>{t("door.pin.sub")}</p>
      </div>
      <form className="dw-form" onSubmit={submit}>
        <DigitsInput length={4} value={pin} onChange={setPin} secret label={t("door.pin.label")} />
        <FormError>{error}</FormError>
        <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={pin.length < 4 || busy}>
          {busy ? t("door.pin.checking") : t("door.pin.continue")}
        </button>
      </form>
      <Link to="/login" className="dw-link dw-center">{t("door.backToSignIn")}</Link>
    </AuthDoorway>
  );
}

/**
 * /login/link?token=… — where a sign-in link lands. It does NOT sign in on
 * arrival: mail scanners open links, and some run the page's script, so a
 * visible "Continue" is what spends the one-time link.
 */
export function MagicLinkLanding() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : t("door.err.linkInvalid"));
  const [ticket, setTicket] = useState<string | null>(null);

  const done = async (res: SignInResponse) => {
    if (res.requiresPin && res.ticket) { setTicket(res.ticket); return; }
    await applyLogin(res.accessToken!);
    navigate("/", { replace: true });
  };

  if (ticket) return <TicketPin ticket={ticket} onDone={done} />;

  const go = async () => {
    setBusy(true); setError("");
    try { await done(await api.post<SignInResponse>("/auth/magic-link/consume", { token })); } catch (err) {
      setError(errorText(t, apiErr(err), "door.err.linkInvalid"));
    } finally { setBusy(false); }
  };

  return (
    <AuthDoorway>
      <div className="dw-state">
        <span className="dw-state__icon"><FontAwesomeIcon icon={faWandMagicSparkles} /></span>
        <h1>{t("door.landing.title")}</h1>
        <p>{t("door.landing.sub")}</p>
        <FormError>{error}</FormError>
        {!error || token ? (
          <button type="button" className="dw-btn dw-btn--primary dw-btn--wide" disabled={busy || !token} onClick={go}>
            {busy ? t("door.landing.signingIn") : t("door.landing.continue")}
          </button>
        ) : null}
        <Link to="/login" className="dw-link">{t("door.backToSignIn")}</Link>
      </div>
    </AuthDoorway>
  );
}

/**
 * /login/complete — where a provider sign-in returns. The session is already
 * in the httpOnly cookie; the app's boot refresh picks it up, and this page
 * only waits for that. A PIN-protected account arrives with a ticket instead.
 */
export function SignInComplete() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const to = safeReturnTo(params.get("to"));
  const ticket = params.get("pin");
  const { isAuthenticated, isLoading } = useAuth();
  const [stuck, setStuck] = useState(false);

  // The boot refresh already ran; if it found no session, give it a moment
  // and then say so rather than spinning. Re-armed whenever these change.
  useEffect(() => {
    if (ticket || isLoading || isAuthenticated) return;
    const id = setTimeout(() => setStuck(true), 1500);
    return () => clearTimeout(id);
  }, [ticket, isLoading, isAuthenticated]);

  if (ticket) {
    return <TicketPin ticket={ticket} onDone={async (res) => { await applyLogin(res.accessToken!); navigate(to, { replace: true }); }} />;
  }
  if (isAuthenticated) return <Navigate to={to} replace />;
  return (
    <AuthDoorway>
      <div className="dw-state">
        <span className="dw-spinner" aria-hidden />
        <h1>{stuck ? t("door.complete.stuckTitle") : t("door.complete.title")}</h1>
        {stuck && <p>{t("door.complete.stuckSub")}</p>}
        {stuck && <Link to="/login" className="dw-btn dw-btn--primary dw-btn--wide">{t("door.backToSignIn")}</Link>}
      </div>
    </AuthDoorway>
  );
}

/** /reset-password?token=… — choose a new password from a reset link. */
export function ResetPanel() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? "" : t("door.err.resetInvalid"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError(t("door.reset.minLength")); return; }
    setBusy(true); setError("");
    try {
      await api.post("/auth/password-reset/confirm", { token, password });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      const e2 = apiErr(err);
      setError(e2.code === "XEC-AUTH-1007" ? t("door.err.resetInvalid") : errorText(t, e2));
    } finally { setBusy(false); }
  };

  return (
    <AuthDoorway>
      <div className="dw-head">
        <h1>{done ? t("door.reset.doneTitle") : t("door.reset.title")}</h1>
        <p>{done ? t("door.reset.doneSub") : t("door.reset.sub")}</p>
      </div>
      {!done && (
        <form className="dw-form" onSubmit={submit}>
          <div className="dw-field">
            <label className="dw-label" htmlFor="dw-reset-password">{t("door.reset.newPassword")}</label>
            <PasswordInput id="dw-reset-password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          </div>
          <FormError>{error}</FormError>
          <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={busy || !token}>{busy ? t("door.reset.saving") : t("door.reset.save")}</button>
        </form>
      )}
      <Link to="/login" className="dw-link dw-center">{t("door.backToSignIn")}</Link>
    </AuthDoorway>
  );
}
