/**
 * Two-factor sign-in with an authenticator app (Google Authenticator, 1Password,
 * Authy…). Off → scan a QR code, type the first code, keep the recovery codes. On →
 * new recovery codes, or turn it off; both ask for a current code.
 *
 * ⚠ The recovery codes are shown ONCE, here, right after they are made. The server
 * keeps only their hashes, so "I've saved them" is the person's last look.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faCopy, faDownload, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { AccountCard } from "../components/AccountCard";
import { useDateTime } from "../../../lib/datetime";

interface TwoFactorState { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean }
type Mode = null | "setup" | "disable" | "regenerate";

const STATE_KEY = ["account", "twoFactor"];

/** Space the secret in fours, the way it is easiest to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

function useQrDataUrl(uri: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!uri) return;
    let live = true;
    // Loaded on demand: only someone turning 2FA on ever needs it.
    void import("qrcode").then((qr) => qr.toDataURL(uri, { margin: 1, width: 200 })).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [uri]);
  return url;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation("account");
  const text = codes.join("\n");
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => toast.success(t("security.tfa.copied")));
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="acct-tfa">
      <p className="account-hint">
        <FontAwesomeIcon className="acct-ic" icon={faTriangleExclamation} /> {t("security.tfa.codesOnce")}
      </p>
      <ul className="acct-tfa__codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="acct-actions">
        <button className="acct-btn" type="button" onClick={copy}><FontAwesomeIcon icon={faCopy} /> {t("security.tfa.copy")}</button>
        <button className="acct-btn" type="button" onClick={download}><FontAwesomeIcon icon={faDownload} /> {t("security.tfa.download")}</button>
        <button className="acct-btn acct-btn--primary" type="button" onClick={onDone}>{t("security.tfa.saved")}</button>
      </div>
    </div>
  );
}

export function TwoFactorCard() {
  const { t } = useTranslation("account");
  const dt = useDateTime();
  const queryClient = useQueryClient();
  const { data: state } = useQuery({ queryKey: STATE_KEY, queryFn: () => api.get<TwoFactorState>("/account/two-factor") });

  const [mode, setMode] = useState<Mode>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const qr = useQrDataUrl(setup?.uri ?? null);

  function reset() {
    setMode(null); setSetup(null); setCode("");
  }

  function refresh(enabled: boolean) {
    if (authStore.user && authStore.token) {
      authStore.set(authStore.token, {
        ...authStore.user,
        twoFactor: { enabled, required: authStore.user.twoFactor?.required ?? false },
        ...(enabled ? { loginPinEnabled: false } : {}),
      });
    }
    void queryClient.invalidateQueries({ queryKey: STATE_KEY });
    void queryClient.invalidateQueries({ queryKey: ["account", "sessions"] });
  }

  const begin = useMutation({
    mutationFn: () => api.post<{ secret: string; uri: string }>("/account/two-factor/setup", {}),
    onSuccess: (res) => { setSetup(res); setMode("setup"); setCode(""); },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.tfa.failed"))),
  });

  const enable = useMutation({
    mutationFn: (c: string) => api.post<{ recoveryCodes: string[] }>("/account/two-factor/enable", { code: c }),
    onSuccess: (res) => { reset(); setCodes(res.recoveryCodes); refresh(true); toast.success(t("security.tfa.enabled")); },
    onError: (e) => { setCode(""); toast.error(apiErrorMessage(e, t("security.tfa.failed"))); },
  });

  const disable = useMutation({
    mutationFn: (c: string) => api.post("/account/two-factor/disable", { code: c }),
    onSuccess: () => { reset(); refresh(false); toast.success(t("security.tfa.disabled")); },
    onError: (e) => { setCode(""); toast.error(apiErrorMessage(e, t("security.tfa.failed"))); },
  });

  const regenerate = useMutation({
    mutationFn: (c: string) => api.post<{ recoveryCodes: string[] }>("/account/two-factor/recovery-codes", { code: c }),
    onSuccess: (res) => { reset(); setCodes(res.recoveryCodes); void queryClient.invalidateQueries({ queryKey: STATE_KEY }); },
    onError: (e) => { setCode(""); toast.error(apiErrorMessage(e, t("security.tfa.failed"))); },
  });

  const busy = begin.isPending || enable.isPending || disable.isPending || regenerate.isPending;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (mode === "setup") enable.mutate(c);
    else if (mode === "disable") disable.mutate(c);
    else if (mode === "regenerate") regenerate.mutate(c);
  };
  // Turning it off accepts a recovery code too (someone without their phone).
  const codeOk = mode === "disable" ? code.trim().length >= 6 : /^\d{6}$/.test(code.trim());

  const enabled = !!state?.enabled;
  const desc = enabled
    ? t("security.tfa.onDesc", { date: state?.enabledAt ? dt.date(state.enabledAt) : "", left: state?.recoveryCodesLeft ?? 0 })
    : t("security.tfa.offDesc");

  return (
    <AccountCard title={t("security.tfa.title")} desc={desc}>
      {state?.required && !enabled && (
        <p className="account-hint acct-tfa__required">
          <FontAwesomeIcon className="acct-ic" icon={faTriangleExclamation} /> {t("security.tfa.requiredHint")}
        </p>
      )}

      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

      {!codes && mode === null && (
        <div className="acct-actions">
          {enabled ? (
            <>
              <button className="acct-btn" type="button" onClick={() => setMode("regenerate")}>{t("security.tfa.newCodes")}</button>
              <button className="acct-btn" type="button" onClick={() => setMode("disable")}>{t("security.tfa.turnOff")}</button>
            </>
          ) : (
            <button className="acct-btn acct-btn--primary" type="button" disabled={busy || !state} onClick={() => begin.mutate()}>
              {t("security.tfa.turnOn")}
            </button>
          )}
        </div>
      )}

      {!codes && mode !== null && (
        <form className="acct-tfa" onSubmit={submit}>
          {mode === "setup" && setup && (
            <div className="acct-tfa__setup">
              <div className="acct-tfa__qr">
                {qr ? <img src={qr} alt={t("security.tfa.qrAlt")} width={200} height={200} /> : <span className="acct-tfa__qr-wait" />}
              </div>
              <ol className="acct-tfa__steps">
                <li>{t("security.tfa.step1")}</li>
                <li>
                  {t("security.tfa.step2")}
                  <code className="acct-tfa__secret">{grouped(setup.secret)}</code>
                </li>
                <li>{t("security.tfa.step3")}</li>
              </ol>
            </div>
          )}
          <div className="account-field">
            <label className="account-label" htmlFor="tfa-code">
              {mode === "disable" ? t("security.tfa.codeOrRecovery") : t("security.tfa.codeLabel")}
            </label>
            <input id="tfa-code" className="account-input acct-tfa__code" autoFocus required
              inputMode={mode === "disable" ? "text" : "numeric"} autoComplete="one-time-code" maxLength={20}
              value={code} onChange={(e) => setCode(mode === "disable" ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </div>
          <div className="acct-actions">
            <button className={`acct-btn ${mode === "disable" ? "acct-btn--danger" : "acct-btn--primary"}`} type="submit" disabled={busy || !codeOk}>
              {busy ? t("security.saving")
                : mode === "setup" ? t("security.tfa.turnOn")
                  : mode === "disable" ? t("security.tfa.turnOff")
                    : t("security.tfa.newCodes")}
            </button>
            <button className="acct-btn" type="button" onClick={reset} disabled={busy}>{t("security.cancel")}</button>
          </div>
        </form>
      )}
    </AccountCard>
  );
}
