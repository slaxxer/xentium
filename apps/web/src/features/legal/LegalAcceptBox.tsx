import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { legalPath, type LegalDocumentKey } from "@xentium/contracts";
import { api } from "../../lib/api";
import { authStore } from "../../lib/authStore";
import { toast } from "../../lib/toast";
import { apiErrorMessage } from "../../lib/swal";
import { applyLogout } from "../../hooks/useAuth";
import { takeLegalReturnPath } from "../auth/LegalConsentGate";

/**
 * The foot of a legal document a member still has to accept: a checkbox, Accept,
 * and the way out (signing out, since the site can't keep using an account on
 * terms its owner hasn't accepted). Accepting records this document only; the
 * next one waiting opens, or the member goes back to where they were headed.
 */
export function LegalAcceptBox({ docKey }: { docKey: LegalDocumentKey }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const { pending } = await api.post<{ pending: LegalDocumentKey[] }>("/auth/legal-consent", { keys: [docKey] });
      const token = authStore.token;
      if (token && authStore.user) authStore.set(token, { ...authStore.user, pendingLegal: pending, needsLegalConsent: pending.length > 0 });
      setAgreed(false);
      navigate(pending.length ? legalPath(pending[0]!) : takeLegalReturnPath(), { replace: true });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try { await api.post("/auth/logout"); } catch { /* signed out locally either way */ }
    applyLogout();
  }

  return (
    <section className="legal-accept" aria-label={t("legal.accept.label")}>
      <label className="legal-accept__check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{t("legal.accept.checkbox", { title: t(`legal.title.${docKey}`) })}</span>
      </label>
      <div className="legal-accept__actions">
        <button type="button" className="legal-accept__out" onClick={signOut}>{t("legal.accept.signOut")}</button>
        <button type="button" className="btn-primary" disabled={!agreed || busy} onClick={accept}>{t("legal.accept.submit")}</button>
      </div>
    </section>
  );
}
