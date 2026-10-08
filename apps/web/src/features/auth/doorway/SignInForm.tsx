import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { applyLogin } from "../../../hooks/useAuth";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { api } from "../../../lib/api";
import { useAuthMethods } from "./AuthDoorway";
import { apiErr, codeText, errorText, pinErrorText } from "./authErrors";
import { DigitsInput, FormError, OrDivider, PasskeyButton, PasswordInput, ProviderButtons } from "./pieces";
import {
  completePin, isPasskeyCancel, passkeysSupported, signInWithPasskey, startProvider, type SignInResponse,
} from "./signInClient";

type Pending = { kind: "password" } | { kind: "ticket"; ticket: string };

/**
 * Every way in, plus the PIN step any of them can end at — ONE implementation for the
 * /login page and the masthead dropdown, so the two can never disagree about how
 * signing in works. The caller supplies the heading (`head`), where to go afterwards
 * (`onSignedIn`) and where a provider should bring the visitor back to (`returnTo`).
 *
 * `compact` is the dropdown: provider buttons as icons beside the passkey button, and
 * the "Email me a link" action left to the caller's footer.
 */
export function SignInForm({ head, returnTo, onSignedIn, onEmailLink, compact = false, initialError = null }: {
  head: { title: string; sub: string };
  returnTo: string;
  onSignedIn: () => void;
  onEmailLink?: (identifier: string) => void;
  compact?: boolean;
  /** A provider redirect's error code, from the URL. Worded at render time, cleared on the next try. */
  initialError?: string | null;
}) {
  const { t } = useTranslation("auth");
  const { data: methods } = useAuthMethods();
  const { data: siteConfig } = useSiteConfig();
  const loginMethod = siteConfig?.auth?.loginMethod ?? "email";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState<string | null>(initialError);
  // A wrong email/password marks both fields, as well as saying so.
  const [badCredentials, setBadCredentials] = useState(false);

  async function finish(res: SignInResponse, via: Pending["kind"]) {
    if (res.requiresPin) {
      setPending(via === "ticket" && res.ticket ? { kind: "ticket", ticket: res.ticket } : { kind: "password" });
      setPin("");
      return;
    }
    await applyLogin(res.accessToken!);
    onSignedIn();
  }

  async function run(tag: string, fn: () => Promise<void>) {
    setBusy(tag);
    setError("");
    setUrlError(null);
    setBadCredentials(false);
    try { await fn(); } catch (err) {
      if (isPasskeyCancel(err)) return;
      const e = apiErr(err);
      // In the PIN step the only credential being checked is the PIN.
      setError(pending ? pinErrorText(t, e) : errorText(t, e));
      if (pending) setPin("");
      else if (tag === "password" && e.code === "XEC-AUTH-1001") setBadCredentials(true);
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

  const Heading = compact ? "h2" : "h1";

  if (pending) {
    return (
      <>
        <div className="dw-head">
          <Heading>{t("door.pin.title")}</Heading>
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
      </>
    );
  }

  const showPasskey = !!methods?.passkeys && passkeysSupported();
  const providers = methods?.providers ?? [];
  const idLabel = loginMethod === "username" ? t("door.username") : loginMethod === "either" ? t("door.identifier") : t("door.email");

  return (
    <>
      <div className="dw-head">
        <Heading>{head.title}</Heading>
        <p>{head.sub}</p>
      </div>

      {(showPasskey || providers.length > 0) && (
        <div className="dw-quick">
          {compact ? (
            <div className="dw-quick__row">
              {showPasskey && <PasskeyButton onClick={passkey} busy={busy === "passkey"} short />}
              <ProviderButtons providers={providers} onPick={provider} busy={busy} iconOnly />
            </div>
          ) : (
            <>
              {showPasskey && <PasskeyButton onClick={passkey} busy={busy === "passkey"} />}
              <ProviderButtons providers={providers} onPick={provider} busy={busy} />
            </>
          )}
          <OrDivider>{t("door.orEmail")}</OrDivider>
        </div>
      )}

      <form className="dw-form" onSubmit={submitPassword}>
        <label className="dw-field">
          <span className="dw-label">{idLabel}</span>
          <input className={`dw-input${badCredentials ? " is-invalid" : ""}`} type={loginMethod === "email" ? "email" : "text"}
            value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            autoComplete={loginMethod === "email" ? "email" : "username webauthn"}
            required autoFocus={!showPasskey} />
        </label>
        <div className="dw-field">
          <span className="dw-label dw-label--row">
            <label htmlFor={compact ? "dw-menu-password" : "dw-password"}>{t("door.password")}</label>
            <Link to="/forgot-password" className="dw-link">{compact ? t("door.forgotShort") : t("door.forgotLink")}</Link>
          </span>
          <PasswordInput id={compact ? "dw-menu-password" : "dw-password"} value={password} onChange={setPassword}
            autoComplete="current-password" invalid={badCredentials} />
        </div>
        <div className="dw-row">
          <label className="dw-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t("door.remember")}</span>
          </label>
          {!compact && methods?.magicLink && onEmailLink && (
            <button type="button" className="dw-link" onClick={() => onEmailLink(identifier)}>
              <FontAwesomeIcon icon={faWandMagicSparkles} /> {t("door.link.cta")}
            </button>
          )}
        </div>
        <FormError>{error || (urlError ? codeText(t, urlError) : "")}</FormError>
        <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={!!busy}>
          {busy === "password" ? t("door.signIn.submitting") : t("door.signIn.submit")}
        </button>
      </form>
    </>
  );
}
