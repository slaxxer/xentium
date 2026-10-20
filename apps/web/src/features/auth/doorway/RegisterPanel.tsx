import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { legalPath } from "@xentium/contracts";
import { faCheck, faFingerprint, faLock } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { UserAvatar } from "../../../components/UserAvatar";
import { Toggle } from "../../../components/AcpControls";
import { applyLogin, useAuth } from "../../../hooks/useAuth";
import { useRegistrationStatus } from "../../../hooks/useRegistrationStatus";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { api } from "../../../lib/api";
import { useLegalLinks } from "../../../lib/legalApi";
import { AuthDoorway, useAuthMethods, useDoorwayStats } from "./AuthDoorway";
import { apiErr, errorText } from "./authErrors";
import { DigitsInput, FormError, OrDivider, PasswordInput, ProviderButtons } from "./pieces";
import { addPasskey, deviceName, isPasskeyCancel, passkeysSupported, startProvider } from "./signInClient";
import { uiLocale } from "../../../lib/i18n";
import { fieldLabel } from "../../../lib/coreText";
import { ProfileFieldInput } from "../../profiles/ProfileFieldInput";

interface ProfileFieldDef {
  id: string; key: string; label: string; type: string; placeholder: string | null;
  helpText: string | null; maxLength: number | null; options: string[] | null;
  showOnRegistration: boolean; requiredOnRegistration: boolean;
}
type Avail = "idle" | "checking" | "free" | "taken";
type Step = "invite" | "account" | "security" | "verify" | "done";

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());
const isUsername = (s: string) => /^[a-zA-Z0-9_-]{3,30}$/.test(s.trim());

/** 0–4, the same rough rule the old wizard used: length and character variety. */
export function passwordStrength(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 14) s = Math.max(s, 3);
  return pw.length < 8 ? Math.min(s, 1) : Math.min(s, 4);
}

/** A live "is this free?" probe, debounced; failures fall back to idle (the server stays authoritative). */
function useAvailability(field: "email" | "username", value: string, valid: boolean): Avail {
  const [state, setState] = useState<Avail>("idle");
  useEffect(() => {
    if (!valid) { setState("idle"); return; }
    setState("checking");
    let cancelled = false;
    const id = setTimeout(() => {
      api.post<Record<string, boolean | undefined>>("/auth/register/check-availability", { [field]: value.trim() })
        .then((r) => { if (!cancelled) setState(r[field] === false ? "taken" : "free"); })
        .catch(() => { if (!cancelled) setState("idle"); });
    }, 450);
    return () => { cancelled = true; clearTimeout(id); };
  }, [field, value, valid]);
  return state;
}

export function RegisterPanel() {
  const { t } = useTranslation("auth");
  const { isAuthenticated } = useAuth();
  const { open, inviteRequired, closedTitle, closedBody } = useRegistrationStatus();
  const { data: siteConfig } = useSiteConfig();
  const { data: methods } = useAuthMethods();
  const { data: stats } = useDoorwayStats();
  const collectName = siteConfig?.auth?.collectName ?? false;
  const nameRequired = siteConfig?.auth?.nameRequired ?? false;

  const [step, setStep] = useState<Step>("account");
  const [invite, setInvite] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<ProfileFieldDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [pinOn, setPinOn] = useState(false);
  const [pin, setPin] = useState("");
  const [wantPasskey, setWantPasskey] = useState(false);
  // Published terms / privacy policy. With either, joining asks the member to accept them.
  const legal = useLegalLinks();
  const hasTerms = legal.some((d) => d.key === "terms");
  const hasPrivacy = legal.some((d) => d.key === "privacy");
  const needsConsent = hasTerms || hasPrivacy;
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [passkeyState, setPasskeyState] = useState<"idle" | "adding" | "added" | "failed">("idle");

  const emailAvail = useAvailability("email", email, isEmail(email));
  const userAvail = useAvailability("username", username, isUsername(username));

  useEffect(() => {
    api.get<ProfileFieldDef[]>("/users/profile-fields").then((f) => setFields(f.filter((x) => x.showOnRegistration))).catch(() => {});
  }, []);
  useEffect(() => { if (inviteRequired && !invite) setStep("invite"); }, [inviteRequired, invite]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // The success screen belongs to the new member; anyone else signed in goes home.
  if (isAuthenticated && step !== "done") return <Navigate to="/" replace />;

  if (!open && !inviteRequired) {
    return (
      <AuthDoorway corner="signIn">
        <div className="dw-state">
          <span className="dw-state__icon"><FontAwesomeIcon icon={faLock} /></span>
          <h1>{closedTitle ?? t("door.closed.title")}</h1>
          <p>{closedBody ?? t("door.closed.body")}</p>
          <Link to="/login" className="dw-btn dw-btn--primary dw-btn--wide">{t("door.closed.signIn")}</Link>
        </div>
      </AuthDoorway>
    );
  }

  const run = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag); setError("");
    try { await fn(); } catch (err) { if (!isPasskeyCancel(err)) setError(errorText(t, apiErr(err))); } finally { setBusy(null); }
  };

  const requiredFields = fields.filter((f) => f.requiredOnRegistration);
  const optionalFields = fields.filter((f) => !f.requiredOnRegistration);
  const strength = passwordStrength(password);
  const providers = methods?.providers ?? [];
  const canPasskey = !!methods?.passkeys && passkeysSupported();

  const accountReady = isEmail(email) && isUsername(username) && emailAvail !== "taken" && userAvail !== "taken"
    && (!collectName || !nameRequired || !!name.trim())
    && requiredFields.every((f) => (values[f.id] ?? "").trim());
  const securityReady = password.length >= 8 && strength >= 2 && (!pinOn || pin.length === 4) && (!needsConsent || agreed);

  const redeem = (e: FormEvent) => {
    e.preventDefault();
    void run("invite", async () => {
      const { valid } = await api.post<{ valid: boolean }>("/auth/register/check-invite", { code: invite.trim() });
      if (!valid) { setError(t("door.err.inviteInvalid")); return; }
      setInvite(invite.trim().toUpperCase());
      setStep("account");
    });
  };

  const toSecurity = (e: FormEvent) => {
    e.preventDefault();
    void run("account", async () => {
      const r = await api.post<{ email?: boolean; username?: boolean }>("/auth/register/check-availability", { email: email.trim(), username: username.trim() });
      if (r.email === false) { setError(t("door.err.emailTaken")); return; }
      if (r.username === false) { setError(t("door.err.usernameTaken")); return; }
      setStep("security");
    });
  };

  const sendCode = () => run("code", async () => {
    await api.post("/auth/register/send-code", { email: email.trim() });
    setCooldown(60);
    setStep("verify");
  });

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run("create", async () => {
      const res = await api.post<{ accessToken: string }>("/auth/register", {
        email: email.trim(), username: username.trim(), password, emailCode: code,
        name: collectName && name.trim() ? name.trim() : undefined,
        loginPinEnabled: pinOn && pin.length === 4, loginPin: pinOn && pin.length === 4 ? pin : undefined,
        inviteCode: invite || undefined,
        acceptLegal: needsConsent ? agreed : undefined,
        fields: fields.filter((f) => (values[f.id] ?? "").trim())
          // No privacy: each answer starts with its field's default (ACP → Profile Fields).
          .map((f) => ({ fieldId: f.id, value: values[f.id]!.trim() })),
      });
      setStep("done");
      await applyLogin(res.accessToken);
      // A passkey needs an account to belong to, so it is made now, not in step 2.
      if (wantPasskey) {
        setPasskeyState("adding");
        try { await addPasskey(deviceName()); setPasskeyState("added"); } catch { setPasskeyState("failed"); }
      }
    });
  };

  const stepIndex = { invite: 0, account: 1, security: 2, verify: 3, done: 4 }[step];
  const progress = (
    <ol className={`dw-steps${step === "done" ? " is-done" : ""}`}>
      {(["account", "security", "verify"] as const).map((s, i) => {
        const state = stepIndex > i + 1 ? "done" : stepIndex === i + 1 ? "on" : "todo";
        return (
          <li key={s} className={`dw-steps__item is-${state}`}>
            {state === "done" ? <FontAwesomeIcon icon={faCheck} /> : `${i + 1} ·`} {t(`door.reg.step.${s}`)}
          </li>
        );
      })}
    </ol>
  );

  if (step === "invite") {
    return (
      <AuthDoorway corner="signIn">
        <div className="dw-state dw-state--left">
          <span className="dw-state__icon"><FontAwesomeIcon icon={faLock} /></span>
          <h1>{closedTitle ?? t("door.invite.title")}</h1>
          <p>{closedBody ?? t("door.invite.body")}</p>
        </div>
        <form className="dw-form" onSubmit={redeem}>
          <label className="dw-field">
            <span className="dw-label">{t("door.invite.code")}</span>
            <span className="dw-inline">
              <input className="dw-input dw-input--code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())}
                autoComplete="off" spellCheck={false} autoFocus required />
              <button className="dw-btn dw-btn--primary" disabled={!invite.trim() || !!busy}>{t("door.invite.redeem")}</button>
            </span>
          </label>
          <FormError>{error}</FormError>
        </form>
        <p className="dw-center dw-muted">{t("door.invite.member")} <Link to="/login" className="dw-link">{t("door.tabs.signIn")}</Link></p>
      </AuthDoorway>
    );
  }

  if (step === "done") {
    return (
      <AuthDoorway corner="home">
        {progress}
        <div className="dw-state">
          <span className="dw-welcome-avatar">
            <UserAvatar user={{ username: username.trim() }} size={64} />
            <span className="dw-welcome-avatar__tick"><FontAwesomeIcon icon={faCheck} /></span>
          </span>
          <h1>{t("door.done.title", { name: name.trim() || username.trim() })}</h1>
          <p>{t("door.done.body", { email: email.trim() })}</p>
          {passkeyState === "adding" && <p className="dw-note"><FontAwesomeIcon icon={faFingerprint} /> {t("door.done.passkeyAdding")}</p>}
          {passkeyState === "added" && <p className="dw-note is-ok"><FontAwesomeIcon icon={faCheck} /> {t("door.done.passkeyAdded")}</p>}
          {passkeyState === "failed" && <p className="dw-note">{t("door.done.passkeyLater")}</p>}
          <Link to="/" className="dw-btn dw-btn--primary dw-btn--wide">{t("door.done.home")}</Link>
          <Link to="/account" className="dw-btn dw-btn--outline dw-btn--wide">{t("door.done.profile")}</Link>
        </div>
      </AuthDoorway>
    );
  }

  return (
    <AuthDoorway corner="signIn">
      {progress}

      {step === "account" && (
        <>
          <div className="dw-head">
            <h1>{t("door.reg.accountTitle")}</h1>
            <p>{stats ? t("door.reg.accountSub", { count: stats.members, formatted: stats.members.toLocaleString(uiLocale()), site: stats.siteName }) : " "}</p>
          </div>
          {providers.length > 0 && (
            <div className="dw-quick">
              <ProviderButtons providers={providers} busy={busy} onPick={(p) => run(p, () => startProvider(p, true, "/"))} />
              <OrDivider>{t("door.orEmail")}</OrDivider>
            </div>
          )}
          <form className="dw-form" onSubmit={toSecurity}>
            <label className="dw-field">
              <span className="dw-label">{t("door.email")}</span>
              <input className={`dw-input${emailAvail === "taken" ? " is-invalid" : ""}`} type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
              <AvailHint state={emailAvail} free={t("door.reg.emailFree")} taken={t("door.err.emailTaken")} />
            </label>
            <label className="dw-field">
              <span className="dw-label">{t("door.username")}</span>
              <span className="dw-prefix">
                <span className="dw-prefix__label">/u/</span>
                <input className={`dw-input${userAvail === "taken" ? " is-invalid" : ""}`} value={username}
                  onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </span>
              {username && !isUsername(username)
                ? <span className="dw-hint is-error">{t("door.reg.usernameRule")}</span>
                : <AvailHint state={userAvail} free={t("door.reg.usernameFree")} taken={t("door.err.usernameTaken")} />}
            </label>
            {collectName && (
              <label className="dw-field">
                <span className="dw-label">{t("door.reg.name")} {!nameRequired && <em>{t("door.optional")}</em>}</span>
                <input className="dw-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80}
                  placeholder={t("door.reg.namePlaceholder")} required={nameRequired} />
              </label>
            )}
            {[...requiredFields, ...optionalFields].map((f) => (
              <label key={f.id} className="dw-field">
                <span className="dw-label">{fieldLabel(f)} {!f.requiredOnRegistration && <em>{t("door.optional")}</em>}</span>
                <ProfileFieldInput field={f} className="dw-input" textareaClassName="dw-input dw-input--area"
                  value={values[f.id] ?? ""} required={f.requiredOnRegistration} chooseLabel={t("door.reg.choose")}
                  onChange={(value) => setValues((v) => ({ ...v, [f.id]: value }))} />
                {f.helpText && <span className="dw-hint">{f.helpText}</span>}
              </label>
            ))}
            <FormError>{error}</FormError>
            <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={!accountReady || !!busy}>
              {busy === "account" ? t("door.reg.checking") : `${t("door.continue")} →`}
            </button>
          </form>
        </>
      )}

      {step === "security" && (
        <form className="dw-form" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <div className="dw-head">
            <h1>{t("door.reg.securityTitle")}</h1>
            <p>{t("door.reg.securitySub")}</p>
          </div>
          <div className="dw-field">
            <label className="dw-label" htmlFor="dw-new-password">{t("door.password")}</label>
            <PasswordInput id="dw-new-password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
            {password && (
              <span className={`dw-strength is-${strength}`}>
                <span className="dw-strength__bars" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={i < strength ? "is-on" : ""} />)}</span>
                <span className="dw-strength__label">{t(`door.reg.strength.${strength}`)}</span>
              </span>
            )}
          </div>

          <div className={`dw-option${pinOn ? " is-on" : ""}`}>
            <Toggle on={pinOn} onToggle={() => { setPinOn(!pinOn); setPin(""); }} />
            <div className="dw-option__text">
              <strong>{t("door.reg.pinTitle")}</strong>
              <span>{t("door.reg.pinSub")}</span>
            </div>
            {pinOn && <DigitsInput length={4} value={pin} onChange={setPin} secret label={t("door.pin.label")} />}
          </div>

          {canPasskey && (
            <div className={`dw-option${wantPasskey ? " is-on" : ""}`}>
              <Toggle on={wantPasskey} onToggle={() => setWantPasskey(!wantPasskey)} />
              <div className="dw-option__text">
                <strong>{t("door.reg.passkeyTitle")}</strong>
                <span>{t("door.reg.passkeySub")}</span>
              </div>
              <FontAwesomeIcon icon={faFingerprint} className="dw-option__icon" />
            </div>
          )}

          {needsConsent && (
            <label className="dw-check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                <Trans
                  t={t}
                  i18nKey={hasTerms && hasPrivacy ? "door.reg.agreeBoth" : hasTerms ? "door.reg.agreeTerms" : "door.reg.agreePrivacy"}
                  components={{
                    terms:   <Link to={legalPath("terms")} target="_blank" rel="noreferrer" className="dw-link" />,
                    privacy: <Link to={legalPath("privacy")} target="_blank" rel="noreferrer" className="dw-link" />,
                  }}
                />
              </span>
            </label>
          )}

          <FormError>{error}</FormError>
          <div className="dw-nav">
            <button type="button" className="dw-btn dw-btn--ghost dw-btn--square" onClick={() => { setError(""); setStep("account"); }} aria-label={t("door.back")}>←</button>
            <button className="dw-btn dw-btn--primary dw-grow" disabled={!securityReady || !!busy}>
              {busy === "code" ? t("door.reg.sending") : `${t("door.continue")} →`}
            </button>
          </div>
        </form>
      )}

      {step === "verify" && (
        <form className="dw-form" onSubmit={create}>
          <div className="dw-who">
            <UserAvatar user={{ username: username.trim() }} size={34} />
            <span className="dw-who__text"><strong>@{username.trim()}</strong><span>{email.trim()}</span></span>
            <button type="button" className="dw-link" onClick={() => { setCode(""); setStep("account"); }}>{t("door.edit")}</button>
          </div>
          <div className="dw-head">
            <h1>{t("door.reg.verifyTitle")}</h1>
            <p>{t("door.reg.verifySub", { email: email.trim() })}</p>
          </div>
          <DigitsInput length={6} value={code} onChange={setCode} label={t("door.reg.codeLabel")} />
          <p className="dw-center dw-muted">
            {t("door.reg.noCode")}{" "}
            <button type="button" className="dw-link" disabled={cooldown > 0 || !!busy} onClick={() => void run("resend", async () => {
              await api.post("/auth/register/send-code", { email: email.trim() }); setCooldown(60);
            })}>
              {cooldown > 0 ? t("door.reg.resendIn", { s: cooldown }) : t("door.reg.resend")}
            </button>
          </p>
          <FormError>{error}</FormError>
          <div className="dw-nav">
            <button type="button" className="dw-btn dw-btn--ghost dw-btn--square" onClick={() => { setError(""); setStep("security"); }} aria-label={t("door.back")}>←</button>
            <button className="dw-btn dw-btn--primary dw-grow" disabled={code.length !== 6 || !!busy}>
              {busy === "create" ? t("door.reg.creating") : t("door.reg.create")}
            </button>
          </div>
        </form>
      )}
    </AuthDoorway>
  );
}

function AvailHint({ state, free, taken }: { state: Avail; free: string; taken: string }) {
  const { t } = useTranslation("auth");
  if (state === "checking") return <span className="dw-hint">{t("door.reg.checkingAvail")}</span>;
  if (state === "free") return <span className="dw-hint is-ok"><FontAwesomeIcon icon={faCheck} /> {free}</span>;
  if (state === "taken") return <span className="dw-hint is-error">{taken}</span>;
  return null;
}
