import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { applyLogin, useAuth } from "../../../hooks/useAuth";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { api } from "../../../lib/api";
import { safeReturnTo } from "../returnTo";
import { AuthDoorway, useAuthMethods, useDoorwayStats } from "./AuthDoorway";
import { apiErr, codeText, errorText, pinErrorText } from "./authErrors";
import { DigitsInput, FormError, OrDivider, PasskeyButton, PasswordInput, ProviderButtons } from "./pieces";
import {
  completePin, isPasskeyCancel, passkeysSupported, signInWithPasskey, startProvider, type SignInResponse,
} from "./signInClient";

type Pending = { kind: "password" } | { kind: "ticket"; ticket: string };

/** /login — every way in, plus the PIN step any of them can end at. */
export function SignInPanel() {
  const { t } = useTranslation("auth");
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const { data: methods } = useAuthMethods();
  const { data: stats } = useDoorwayStats();
  const { data: siteConfig } = useSiteConfig();
  const loginMethod = siteConfig?.auth?.loginMethod ?? "email";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // A provider redirect's error arrives as a code in the URL; it is worded at
  // render time so switching language re-words it, and cleared on the next try.
  const [urlError, setUrlError] = useState<string | null>(() => params.get("error"));
  const [linkMode, setLinkMode] = useState(false);

  if (isAuthenticated && !busy) return <Navigate to={returnTo} replace />;

  async function finish(res: SignInResponse, via: Pending["kind"]) {
    if (res.requiresPin) {
      setPending(via === "ticket" && res.ticket ? { kind: "ticket", ticket: res.ticket } : { kind: "password" });
      setPin("");
      return;
    }
    await applyLogin(res.accessToken!);
    navigate(returnTo, { replace: true });
  }

  async function run(tag: string, fn: () => Promise<void>) {
    setBusy(tag);
    setError("");
    setUrlError(null);
    try { await fn(); } catch (err) {
      if (isPasskeyCancel(err)) return;
      // In the PIN step the only credential being checked is the PIN.
      setError(pending ? pinErrorText(t, apiErr(err)) : errorText(t, apiErr(err)));
      if (pending) setPin("");
    } finally { setBusy(null); }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run("password", async () => {
      const body: Record<string, unknown> = { identifier, password, remember };
      if (pending?.kind === "password") body.loginPin = pin;
      await finish(await api.post<SignInResponse>("/auth/login", body), "password");
    });
  };

  const submitPin = (e: FormEvent) => {
    if (pending?.kind === "password") return submitPassword(e);
    e.preventDefault();
    if (pending?.kind !== "ticket") return;
    void run("pin", async () => finish(await completePin(pending.ticket, pin), "ticket"));
  };

  const passkey = () => run("passkey", async () => finish(await signInWithPasskey(remember), "ticket"));
  const provider = (p: string) => run(p, () => startProvider(p, remember, returnTo));

  if (pending) {
    return (
      <AuthDoorway>
        <div className="dw-head">
          <h1>{t("door.pin.title")}</h1>
          <p>{t("door.pin.sub")}</p>
        </div>
        <form className="dw-form" onSubmit={submitPin}>
          <DigitsInput length={4} value={pin} onChange={setPin} secret label={t("door.pin.label")} />
          <FormError>{error}</FormError>
          <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={pin.length < 4 || !!busy}>
            {busy ? t("door.pin.checking") : t("door.pin.continue")}
          </button>
        </form>
        <button type="button" className="dw-link dw-center" onClick={() => { setPending(null); setPin(""); setError(""); }}>
          {t("door.back")}
        </button>
      </AuthDoorway>
    );
  }

  if (linkMode) return <MagicLinkRequest initialEmail={loginMethod === "username" ? "" : identifier} remember={remember} onBack={() => setLinkMode(false)} />;

  const showPasskey = !!methods?.passkeys && passkeysSupported();
  const providers = methods?.providers ?? [];
  const idLabel = loginMethod === "username" ? t("door.username") : loginMethod === "either" ? t("door.identifier") : t("door.email");

  return (
    <AuthDoorway>
      <div className="dw-head">
        <h1>{t("door.signIn.title")}</h1>
        <p>{t("door.signIn.sub", { site: stats?.siteName ?? "" })}</p>
      </div>

      {(showPasskey || providers.length > 0) && (
        <div className="dw-quick">
          {showPasskey && <PasskeyButton onClick={passkey} busy={busy === "passkey"} />}
          <ProviderButtons providers={providers} onPick={provider} busy={busy} />
          <OrDivider>{t("door.orEmail")}</OrDivider>
        </div>
      )}

      <form className="dw-form" onSubmit={submitPassword}>
        <label className="dw-field">
          <span className="dw-label">{idLabel}</span>
          <input className="dw-input" type={loginMethod === "email" ? "email" : "text"} value={identifier}
            onChange={(e) => setIdentifier(e.target.value)} autoComplete={loginMethod === "email" ? "email" : "username webauthn"}
            required autoFocus={!showPasskey} />
        </label>
        <div className="dw-field">
          <span className="dw-label dw-label--row">
            <label htmlFor="dw-password">{t("door.password")}</label>
            <Link to="/forgot-password" className="dw-link">{t("door.forgotLink")}</Link>
          </span>
          <PasswordInput id="dw-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <div className="dw-row">
          <label className="dw-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t("door.remember")}</span>
          </label>
          {methods?.magicLink && (
            <button type="button" className="dw-link" onClick={() => { setError(""); setLinkMode(true); }}>
              <FontAwesomeIcon icon={faWandMagicSparkles} /> {t("door.link.cta")}
            </button>
          )}
        </div>
        <FormError>{error || (urlError ? codeText(t, urlError) : "")}</FormError>
        <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={!!busy}>
          {busy === "password" ? t("door.signIn.submitting") : t("door.signIn.submit")}
        </button>
      </form>
    </AuthDoorway>
  );
}

/** "Email me a sign-in link": same answer whether or not the address has an account. */
export function MagicLinkRequest({ initialEmail, remember, onBack }: { initialEmail: string; remember: boolean; onBack: () => void }) {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState(initialEmail.includes("@") ? initialEmail : "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/magic-link", { email: email.trim(), remember });
      setSent(true);
    } catch (err) {
      setError(errorText(t, apiErr(err)));
    } finally { setBusy(false); }
  };

  return (
    <AuthDoorway>
      <div className="dw-head">
        <h1>{sent ? t("door.link.sentTitle") : t("door.link.title")}</h1>
        <p>{sent ? t("door.link.sentSub", { email: email.trim() }) : t("door.link.sub")}</p>
      </div>
      {!sent && (
        <form className="dw-form" onSubmit={submit}>
          <label className="dw-field">
            <span className="dw-label">{t("door.email")}</span>
            <input className="dw-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </label>
          <FormError>{error}</FormError>
          <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={busy}>{busy ? t("door.link.sending") : t("door.link.send")}</button>
        </form>
      )}
      {sent && (
        <button type="button" className="dw-btn dw-btn--ghost dw-btn--wide" onClick={() => setSent(false)}>{t("door.link.again")}</button>
      )}
      <button type="button" className="dw-link dw-center" onClick={onBack}>{t("door.backToSignIn")}</button>
    </AuthDoorway>
  );
}
