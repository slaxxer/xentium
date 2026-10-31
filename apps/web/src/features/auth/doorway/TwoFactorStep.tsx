import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiErr, totpErrorText } from "./authErrors";
import { DigitsInput, FormError } from "./pieces";
import { completeTotp, type SignInResponse } from "./signInClient";

/**
 * The authenticator-code step any sign-in can end at: six digits from the app, or
 * a recovery code for someone without their phone. ONE implementation for the
 * sign-in form, a sign-in link and a provider's return, like the PIN step.
 * `onExpired` runs when the ticket is gone (too slow, or too many wrong codes):
 * the person has to start again, so the caller takes them back.
 */
export function TwoFactorStep({ ticket, onDone, onBack, backLabel, heading = "h1" }: {
  ticket: string;
  onDone: (res: SignInResponse) => Promise<void>;
  onBack: () => void;
  backLabel: string;
  heading?: "h1" | "h2";
}) {
  const { t } = useTranslation("auth");
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const Heading = heading;

  const ready = recovery ? code.replace(/[^a-z0-9]/gi, "").length === 10 : code.length === 6;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    try { await onDone(await completeTotp(ticket, code)); } catch (err) {
      const e2 = apiErr(err);
      setError(totpErrorText(t, e2));
      setCode("");
      if (e2.code === "XEC-AUTH-1073") onBack();
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="dw-head">
        <Heading>{t(recovery ? "door.totp.recoveryTitle" : "door.totp.title")}</Heading>
        <p>{t(recovery ? "door.totp.recoverySub" : "door.totp.sub")}</p>
      </div>
      <form className="dw-form" onSubmit={submit}>
        {recovery ? (
          <label className="dw-field">
            <span className="dw-label">{t("door.totp.recoveryLabel")}</span>
            <input className="dw-input" value={code} onChange={(e) => setCode(e.target.value.slice(0, 20))}
              autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="abcde-fghjk" autoFocus />
          </label>
        ) : (
          <DigitsInput length={6} value={code} onChange={setCode} label={t("door.totp.label")} />
        )}
        <FormError>{error}</FormError>
        <button className="dw-btn dw-btn--primary dw-btn--wide" disabled={!ready || busy}>
          {busy ? t("door.totp.checking") : t("door.totp.continue")}
        </button>
      </form>
      <button type="button" className="dw-link dw-center" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>
        {t(recovery ? "door.totp.useApp" : "door.totp.useRecovery")}
      </button>
      <button type="button" className="dw-link dw-center" onClick={onBack}>{backLabel}</button>
    </>
  );
}
