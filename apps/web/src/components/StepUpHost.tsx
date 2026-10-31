import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "./Icon";
import { getStepUp, resolveStepUp, subscribeStepUp } from "../lib/stepUp";
import "./DialogHost.scss";
import "./StepUpHost.scss";

/**
 * The "confirm with a code" prompt (lib/stepUp.ts). Mounted once in the app root,
 * beside the dialog host, and drawn with its classes so the two look alike.
 */
export function StepUpHost() {
  const prompt = useSyncExternalStore(subscribeStepUp, getStepUp, getStepUp);
  const { t } = useTranslation("common");
  const [code, setCode] = useState("");

  useEffect(() => { setCode(""); }, [prompt?.id, prompt?.error]);
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") resolveStepUp(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt?.id]);

  if (!prompt) return null;
  const clean = code.replace(/\s/g, "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{6}$/.test(clean)) resolveStepUp(clean);
  };
  const error = prompt.error === "XEC-AUTH-1071" ? t("stepUp.used") : prompt.error ? t("stepUp.wrong") : null;

  return (
    <div className="xt-dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) resolveStepUp(null); }}>
      <form className="xt-dialog xt-dialog--question xt-stepup" role="dialog" aria-modal="true" aria-label={t("stepUp.title")} onSubmit={submit}>
        <span className="xt-dialog__icon"><FontAwesomeIcon icon={faShieldHalved} /></span>
        <h2 className="xt-dialog__title">{t("stepUp.title")}</h2>
        <div className="xt-dialog__body">{t("stepUp.body")}</div>
        <input
          className={`xt-stepup__input${error ? " is-invalid" : ""}`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={t("stepUp.label")}
          placeholder="000000"
          autoFocus
        />
        {error && <p className="xt-stepup__error" role="alert">{error}</p>}
        <div className="xt-dialog__actions">
          <button type="button" className="xt-dialog__btn xt-dialog__btn--ghost" onClick={() => resolveStepUp(null)}>
            {t("actions.cancel")}
          </button>
          <button type="submit" className="xt-dialog__btn xt-dialog__btn--primary" disabled={!/^\d{6}$/.test(clean)}>
            {t("stepUp.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
