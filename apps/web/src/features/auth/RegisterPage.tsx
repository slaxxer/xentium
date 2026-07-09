import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Link } from "react-router-dom";
import { useAuth, applyLogin } from "../../hooks/useAuth";
import { useRegistrationStatus } from "../../hooks/useRegistrationStatus";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import { api } from "../../lib/api";
import { swalToast } from "../../lib/swal";
import "./RegisterPage.scss";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileFieldDef {
  id: string;
  key: string;
  label: string;
  type: string;
  placeholder: string | null;
  showOnRegistration: boolean;
  requiredOnRegistration: boolean;
}

type Step = 1 | 2 | 3;

// ─── Step metadata ────────────────────────────────────────────────────────────

const STEPS = [{ n: 1 }, { n: 2 }, { n: 3 }] as const;

// ─── Password strength ────────────────────────────────────────────────────────

function calcStrength(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 14) s++;
  return Math.min(s, 4);
}

const STRENGTH_KEYS = ["", "strengthWeak", "strengthFair", "strengthGood", "strengthStrong"];
const STRENGTH_COLORS = [
  "var(--c-border)",
  "var(--c-danger)",
  "var(--c-warn)",
  "var(--c-info)",
  "var(--c-success)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidEmail(s: string) { return /\S+@\S+\.\S+/.test(s); }
function isValidUsername(s: string) { return /^[a-zA-Z0-9_-]{3,30}$/.test(s); }

// ─── Step indicator ───────────────────────────────────────────────────────────

function Stepper({ step, done }: { step: Step; done: boolean }) {
  const { t } = useTranslation("auth");
  return (
    <div className="reg-wizard__stepper">
      <p className="reg-wizard__stepper-title">{t("register.createAccount")}</p>
      <div className="reg-wizard__steps">
        {STEPS.map((s, i) => {
          const isDone = done || s.n < step;
          const isActive = !done && s.n === step;
          const state = isDone ? "done" : isActive ? "active" : "pending";
          return (
            <div key={s.n} className="reg-wizard__step">
              <div className="reg-wizard__step-spine">
                <div className={`reg-wizard__step-dot reg-wizard__step-dot--${state}`}>
                  {isDone ? "✓" : s.n}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`reg-wizard__step-line reg-wizard__step-line--${isDone ? "done" : "pending"}`} />
                )}
              </div>
              <div className={`reg-wizard__step-info reg-wizard__step-info--${state}`}>
                <div className="reg-wizard__step-label">{t(`register.step${s.n}Label`)}</div>
                <div className="reg-wizard__step-sub">{t(`register.step${s.n}Sub`)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 6-digit code input ───────────────────────────────────────────────────────

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").split("").slice(0, 6);

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      const next = digits.slice();
      next[i] = " ";
      onChange(next.join("").trimEnd());
      refs.current[i - 1]?.focus();
      e.preventDefault();
    }
  }

  function handleChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const ch = e.target.value.replace(/\D/g, "").slice(-1);
    const next = digits.slice();
    next[i] = ch || " ";
    onChange(next.join("").trimEnd());
    if (ch) refs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(text);
    refs.current[Math.min(text.length, 5)]?.focus();
    e.preventDefault();
  }

  return (
    <div className="rw-code-input">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}

// ─── 4-digit PIN input ────────────────────────────────────────────────────────

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(4, " ").split("").slice(0, 4);

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      const next = digits.slice();
      next[i] = " ";
      onChange(next.join("").trimEnd());
      refs.current[i - 1]?.focus();
      e.preventDefault();
    }
  }

  function handleChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const ch = e.target.value.replace(/\D/g, "").slice(-1);
    const next = digits.slice();
    next[i] = ch || " ";
    onChange(next.join("").trimEnd());
    if (ch) refs.current[i + 1]?.focus();
  }

  return (
    <div className="rw-pin-input">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function RegisterPage() {
  const { t } = useTranslation("auth");
  const { isAuthenticated } = useAuth();
  const { open: registrationOpen, inviteRequired, betaMode } = useRegistrationStatus();
  const { data: siteConfig } = useSiteConfig();
  const collectName  = siteConfig?.auth?.collectName ?? false;
  const nameRequired = siteConfig?.auth?.nameRequired ?? false;

  const [step, setStep] = useState<Step>(1);
  const [inviteCode, setInviteCode] = useState("");
  const [done, setDone] = useState(false);

  // Step 1 fields
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [profileFields, setProfileFields] = useState<ProfileFieldDef[]>([]);

  // Step 2 fields
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState("");

  // Terms agreement — the page assigned to the `terms` slot, if any (§page-system).
  const [termsPage, setTermsPage] = useState<{ slug: string; title: string } | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(false);

  // Step 3
  const [emailCode, setEmailCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Error state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<ProfileFieldDef[]>("/users/profile-fields")
      .then((fields) => setProfileFields(fields.filter((f) => f.showOnRegistration)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<{ terms: { slug: string; title: string } | null }>("/pages/slots")
      .then((slots) => setTermsPage(slots.terms))
      .catch(() => {});
  }, []);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const fieldInput = useCallback(
    (f: ProfileFieldDef, errKey?: string) => {
      const err = errKey ? errors[errKey] : undefined;
      return (
        <div className="rw-field" key={f.id}>
          <label className="rw-label">
            {f.label}
            {f.requiredOnRegistration && <span className="rw-label__required">*</span>}
            {f.type === "date" && f.key === "date_of_birth" && (
              <span className="rw-label__hint">{t("register.shownAsAge")}</span>
            )}
          </label>
          <input
            className={`rw-input${err ? " rw-input--error" : ""}`}
            type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
            value={fieldValues[f.id] ?? ""}
            onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
            placeholder={f.placeholder ?? ""}
          />
          {err && <p className="rw-error">{err}</p>}
        </div>
      );
    },
    [fieldValues, errors, t],
  );

  // All hooks above this line — early returns only after all hooks are declared
  if (isAuthenticated) return <Navigate to="/" replace />;

  if (!registrationOpen) {
    return (
      <div className="reg-wizard">
        {/* ── Left panel ── */}
        <div className="reg-wizard__left">
          <div className="reg-wizard__aurora" aria-hidden></div>
          <div className="reg-wizard__vignette" aria-hidden />

          <div className="reg-wizard__brand">
            <div className="reg-wizard__logo-mark">N</div>
            <span className="reg-wizard__wordmark">Nodevo</span>
          </div>

          <div className="reg-wizard__signin-hint">
            {t("register.alreadyMember")} <Link to="/login">{t("register.signIn")}</Link>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="reg-wizard__right">
          <div className="reg-wizard__content" style={{ textAlign: "center" }}>
            <div className="reg-wizard__step-body">
              <div className="rw-closed-icon">{betaMode ? "🚧" : "🔒"}</div>
              <h1 className="reg-wizard__title">
                {betaMode ? t("closed.betaTitle") : t("closed.closedTitle")}
              </h1>
              <p className="reg-wizard__subtitle">
                {betaMode ? t("closed.betaBody") : t("closed.closedBody")}
              </p>
              <Link
                to="/login"
                className="reg-wizard__next"
                style={{ display: "inline-block", textDecoration: "none" }}
              >
                {t("closed.signInToAccount")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const strength = calcStrength(password);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const passwordsMismatch = confirm.length > 0 && password !== confirm;

  const requiredFields = profileFields.filter((f) => f.requiredOnRegistration);
  const optionalFields = profileFields.filter((f) => !f.requiredOnRegistration);

  // ── Step validation ──────────────────────────────────────────────────────

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (!isValidEmail(email)) e.email = t("register.invalidEmail");
    if (!isValidUsername(username)) e.username = t("register.invalidUsername");
    if (collectName && nameRequired && !name.trim()) e.name = t("register.nameRequiredErr");
    for (const f of requiredFields) {
      if (!(fieldValues[f.id] ?? "").trim()) e[`field_${f.id}`] = t("register.required", { label: f.label });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {};
    if (password.length < 8) e.password = t("register.pwMin");
    if (password !== confirm) e.confirm = t("register.pwMismatch");
    if (pinEnabled && pin.length !== 4) e.pin = t("register.pinIncomplete");
    if (termsPage && !agreedTerms) e.terms = t("register.termsRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Step 2 → 3: send verification code ──────────────────────────────────

  async function sendCode() {
    setLoading(true);
    try {
      await api.post("/auth/register/send-code", { email });
      setResendCooldown(60);
      setStep(3);
    } catch (err: any) {
      if (err?.status === 409) {
        swalToast(t("register.emailTaken"));
        setStep(1);
      } else {
        swalToast(t("register.sendFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      await api.post("/auth/register/send-code", { email });
      setResendCooldown(60);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: submit registration ──────────────────────────────────────────

  async function submitRegistration() {
    if (emailCode.length !== 6) {
      swalToast(t("register.codeFull"));
      return;
    }
    setErrors({});
    setLoading(true);

    const fields = profileFields
      .filter((f) => (fieldValues[f.id] ?? "").trim())
      .map((f) => ({ fieldId: f.id, value: (fieldValues[f.id] ?? "").trim(), privacy: "public" as const }));

    try {
      const res = await api.post<{ accessToken: string }>("/auth/register", {
        email,
        username,
        name: collectName && name.trim() ? name.trim() : undefined,
        password,
        emailCode,
        loginPinEnabled: pinEnabled && pin.length === 4,
        loginPin: pinEnabled && pin.length === 4 ? pin : undefined,
        inviteCode: inviteCode.trim() || undefined,
        fields,
      });
      setDone(true);
      await applyLogin(res.accessToken);
    } catch (err: any) {
      const code = err?.detail?.error;
      if (code === "NEC-AUTH-1020") {
        swalToast(t("register.inviteRequiredErr"));
        setStep(1);
      } else if (code === "NEC-AUTH-1021") {
        swalToast(t("register.inviteInvalid"));
        setStep(1);
      } else if (code === "NEC-AUTH-2003" || err?.status === 400) {
        swalToast(t("register.codeWrong"));
      } else if (err?.status === 409) {
        const msg = err?.detail?.message ?? "";
        if (msg.toLowerCase().includes("email")) {
          swalToast(t("register.emailTakenShort"));
          setStep(1);
        } else {
          swalToast(t("register.usernameTaken"));
          setStep(1);
        }
      } else {
        swalToast(t("register.regFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async function handleNext() {
    if (step === 1) {
      if (validateStep1()) setStep(2);
    } else if (step === 2) {
      if (validateStep2()) await sendCode();
    } else {
      await submitRegistration();
    }
  }

  const canAdvance =
    step === 1
      ? isValidEmail(email) && isValidUsername(username)
        && (!collectName || !nameRequired || !!name.trim())
        && requiredFields.every((f) => (fieldValues[f.id] ?? "").trim())
      : step === 2
        ? strength >= 2 && passwordsMatch && (!pinEnabled || pin.length === 4)
        : emailCode.length === 6 && (!inviteRequired || inviteCode.trim().length > 0);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="reg-wizard">
      {/* ── Left panel ── */}
      <div className="reg-wizard__left">
        <div className="reg-wizard__aurora" aria-hidden></div>
        <div className="reg-wizard__vignette" aria-hidden />

        <div className="reg-wizard__brand">
          <div className="reg-wizard__logo-mark">N</div>
          <span className="reg-wizard__wordmark">Nodevo</span>
        </div>

        <Stepper step={step} done={done} />

        <div className="reg-wizard__signin-hint">
          {t("register.alreadyMember")} <Link to="/login">{t("register.signIn")}</Link>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="reg-wizard__right">
        <div className="reg-wizard__content">

          {done ? (
            <div className="reg-wizard__step-body" style={{ textAlign: "center" }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                margin: "0 auto 22px", display: "flex",
                alignItems: "center", justifyContent: "center",
                fontSize: 34,
                background: "var(--c-success-soft)",
                border: "1px solid rgba(52,211,153,0.3)",
              }}>
                📬
              </div>
              <h1 className="reg-wizard__title" style={{ marginBottom: 10 }}>{t("register.doneTitle")}</h1>
              <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.6, maxWidth: 340, margin: "0 auto 26px" }}>
                {t("register.doneBody", { email })}
              </p>
              <Link to="/" className="reg-wizard__next" style={{ display: "block", textDecoration: "none", padding: "12px", borderRadius: "var(--btn-radius)", background: "linear-gradient(135deg,var(--c-accent),var(--c-accent2))", color: "#fff", fontWeight: 700, fontSize: 14 }}>
                {t("register.goHome")}
              </Link>
            </div>
          ) : (
            <div key={step} className="reg-wizard__step-body">
              <div className="reg-wizard__step-tag">{t("register.stepTag", { n: step })}</div>
              <h1 className="reg-wizard__title">{t(`register.step${step}Label`)}</h1>
              <p className="reg-wizard__subtitle">{t(`register.step${step}Sub`)}</p>

              {/* ── Step 1: Account ── */}
              {step === 1 && (
                <>
                  <div className="rw-field">
                    <label className="rw-label">
                      {t("register.email")} <span className="rw-label__required">*</span>
                    </label>
                    <input
                      className={`rw-input${errors.email ? " rw-input--error" : ""}`}
                      type="email"
                      placeholder={t("register.emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                      autoComplete="email"
                    />
                    {errors.email && <p className="rw-error">{errors.email}</p>}
                  </div>

                  <div className="rw-field">
                    <label className="rw-label">
                      {t("register.username")} <span className="rw-label__required">*</span>
                    </label>
                    <input
                      className={`rw-input${errors.username ? " rw-input--error" : ""}`}
                      type="text"
                      placeholder={t("register.usernamePlaceholder")}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                    />
                    {errors.username && <p className="rw-error">{errors.username}</p>}
                  </div>

                  {collectName && (
                    <div className="rw-field">
                      <label className="rw-label">
                        {t("register.name")} {nameRequired && <span className="rw-label__required">*</span>}
                      </label>
                      <input
                        className={`rw-input${errors.name ? " rw-input--error" : ""}`}
                        type="text"
                        placeholder={t("register.namePlaceholder")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        maxLength={80}
                      />
                      {errors.name && <p className="rw-error">{errors.name}</p>}
                    </div>
                  )}

                  {/* Required custom fields */}
                  {requiredFields.map((f) => fieldInput(f, `field_${f.id}`))}

                  {/* Optional custom fields (DOB + others) */}
                  {optionalFields.length > 0 && (
                    <div className="rw-custom-fields">
                      <p className="rw-custom-fields__heading">{t("register.customFields")}</p>
                      {optionalFields.map((f) => fieldInput(f))}
                    </div>
                  )}
                </>
              )}

              {/* ── Step 2: Security ── */}
              {step === 2 && (
                <>
                  <div className="rw-field">
                    <label className="rw-label">
                      {t("register.password")} <span className="rw-label__required">*</span>
                    </label>
                    <div className="rw-input-wrap">
                      <input
                        className={`rw-input${errors.password ? " rw-input--error" : ""}`}
                        type={showPw ? "text" : "password"}
                        placeholder={t("register.passwordPlaceholder")}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoFocus
                        autoComplete="new-password"
                        style={{ paddingRight: 52 }}
                      />
                      <button
                        type="button"
                        className="rw-pw-toggle"
                        onClick={() => setShowPw((v) => !v)}
                      >
                        {showPw ? t("register.hide") : t("register.show")}
                      </button>
                    </div>
                    {errors.password && <p className="rw-error">{errors.password}</p>}
                    {password.length > 0 && (
                      <div className="rw-strength">
                        <div className="rw-strength__bars">
                          {[0, 1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="rw-strength__bar"
                              style={{ background: i < strength ? STRENGTH_COLORS[strength] : undefined }}
                            />
                          ))}
                        </div>
                        <div
                          className="rw-strength__label"
                          style={{ color: STRENGTH_COLORS[strength] }}
                        >
                          {strength >= 1 ? t(`register.${STRENGTH_KEYS[strength]}`) : t("register.tooShort")}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rw-field">
                    <label className="rw-label">
                      {t("register.confirm")} <span className="rw-label__required">*</span>
                    </label>
                    <div className="rw-input-wrap">
                      <input
                        className={`rw-input${errors.confirm || passwordsMismatch ? " rw-input--error" : ""}`}
                        type={showPw ? "text" : "password"}
                        placeholder={t("register.confirmPlaceholder")}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        style={{ paddingRight: 36 }}
                      />
                      {confirm.length > 0 && (
                        <span
                          className="rw-match"
                          style={{ color: passwordsMatch ? "var(--c-success)" : "var(--c-danger)" }}
                        >
                          {passwordsMatch ? "✓" : "✕"}
                        </span>
                      )}
                    </div>
                    {(errors.confirm || passwordsMismatch) && (
                      <p className="rw-error">{errors.confirm || t("register.pwMismatch")}</p>
                    )}
                  </div>

                  {/* Login PIN option */}
                  <label className="rw-pin-toggle">
                    <input
                      type="checkbox"
                      checked={pinEnabled}
                      onChange={(e) => {
                        setPinEnabled(e.target.checked);
                        if (!e.target.checked) setPin("");
                      }}
                    />
                    <div className="rw-pin-toggle__text">
                      <strong>{t("register.pinEnable")}</strong>
                      <span>{t("register.pinDesc")}</span>
                    </div>
                  </label>

                  {pinEnabled && (
                    <>
                      <PinInput value={pin} onChange={setPin} />
                      {errors.pin && <p className="rw-error" style={{ textAlign: "center" }}>{errors.pin}</p>}
                      <p className="rw-hint" style={{ textAlign: "center" }}>
                        {t("register.pinHint")}
                      </p>
                    </>
                  )}

                  {termsPage && (
                    <div className="rw-field" style={{ marginTop: 16 }}>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--c-fg)", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={agreedTerms}
                          onChange={(e) => setAgreedTerms(e.target.checked)}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          {t("register.termsAgree")}{" "}
                          <Link to={`/p/${termsPage.slug}`} target="_blank" rel="noreferrer">
                            {termsPage.title}
                          </Link>
                        </span>
                      </label>
                      {errors.terms && <p className="rw-error">{errors.terms}</p>}
                    </div>
                  )}
                </>
              )}

              {/* ── Step 3: Verify email ── */}
              {step === 3 && (
                <>
                  <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.6, marginBottom: 24 }}>
                    {t("register.verifyLead", { email })}
                  </p>

                  <CodeInput value={emailCode} onChange={setEmailCode} />

                  <p className="rw-resend">
                    {t("register.didntReceive")}{" "}
                    <button
                      onClick={resendCode}
                      disabled={resendCooldown > 0 || loading}
                    >
                      {resendCooldown > 0 ? t("register.resendIn", { s: resendCooldown }) : t("register.resend")}
                    </button>
                  </p>

                  {inviteRequired && (
                    <div className="rw-field" style={{ marginTop: 24 }}>
                      <label className="rw-label">
                        {t("register.inviteCode")} <span className="rw-label__required">*</span>
                      </label>
                      <input
                        className="rw-input"
                        type="text"
                        placeholder={t("register.invitePlaceholder")}
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        autoComplete="off"
                        spellCheck={false}
                        style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}
                      />
                      <p className="rw-hint">{t("register.inviteHint")}</p>
                    </div>
                  )}
                </>
              )}

              {/* ── Navigation ── */}
              <div className="reg-wizard__nav">
                {step > 1 && !loading && (
                  <button
                    className="reg-wizard__back"
                    onClick={() => { setErrors({}); setStep((s) => (s - 1) as Step); }}
                  >
                    ← {t("register.back")}
                  </button>
                )}
                <button
                  className="reg-wizard__next"
                  disabled={!canAdvance || loading}
                  onClick={handleNext}
                >
                  {loading
                    ? step === 2 ? t("register.sendingCode") : step === 3 ? t("register.creating") : "…"
                    : step < 3 ? `${t("register.continue")} →` : t("register.createBtn")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
