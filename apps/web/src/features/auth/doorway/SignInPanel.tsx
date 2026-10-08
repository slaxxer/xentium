import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { safeReturnTo } from "../returnTo";
import { AuthDoorway, useDoorwayStats } from "./AuthDoorway";
import { apiErr, errorText } from "./authErrors";
import { FormError } from "./pieces";
import { SignInForm } from "./SignInForm";

/**
 * /login — the page links, redirects and the masthead's "Email a link" land on. The
 * sign-in itself is `SignInForm`, shared with the masthead dropdown.
 * `?mode=link` opens straight on the sign-in-link request.
 */
export function SignInPanel() {
  const { t } = useTranslation("auth");
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const { data: stats } = useDoorwayStats();
  const [signingIn, setSigningIn] = useState(false);
  const [link, setLink] = useState<{ email: string } | null>(() => (params.get("mode") === "link" ? { email: "" } : null));

  // Already signed in (and not mid-way through signing in here): nothing to do.
  if (isAuthenticated && !signingIn) return <Navigate to={returnTo} replace />;

  if (link) return <MagicLinkRequest initialEmail={link.email} remember onBack={() => setLink(null)} />;

  return (
    <AuthDoorway corner="register">
      <SignInForm
        head={{ title: t("door.signIn.title"), sub: t("door.signIn.sub", { site: stats?.siteName ?? "" }) }}
        returnTo={returnTo}
        initialError={params.get("error")}
        onEmailLink={(identifier) => setLink({ email: identifier })}
        onSignedIn={() => { setSigningIn(true); navigate(returnTo, { replace: true }); }}
      />
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
    <AuthDoorway corner="register">
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
