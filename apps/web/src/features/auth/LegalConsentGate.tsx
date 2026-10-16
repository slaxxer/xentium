import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { legalPath } from "@xentium/contracts";
import { api } from "../../lib/api";
import { authStore } from "../../lib/authStore";
import { openDialog } from "../../lib/dialog";
import { useAuth, applyLogout } from "../../hooks/useAuth";
import { useLegalLinks } from "../../lib/legalApi";

/**
 * Asked once: a member who never accepted the site's terms / privacy policy accepts
 * them before going on. That is everyone a migration tool brought over, and accounts an
 * admin or a sign-in provider created (none of them saw the sign-up form's box). The
 * server says who (`needsLegalConsent` on /auth/me, only while terms or a privacy
 * policy are published) and records the answer.
 *
 * Declining signs the member out: the site can't keep using an account on terms its
 * owner hasn't accepted. The links open in a new tab so the question stays put.
 */
const LINK = { color: "var(--c-accent)", textDecoration: "underline", fontWeight: 600 } as const;

export function LegalConsentGate() {
  const { t } = useTranslation("auth");
  const { user } = useAuth();
  const legal = useLegalLinks();
  const asking = useRef(false);
  const hasTerms = legal.some((d) => d.key === "terms");
  const hasPrivacy = legal.some((d) => d.key === "privacy");

  useEffect(() => {
    if (!user?.needsLegalConsent || asking.current || (!hasTerms && !hasPrivacy)) return;
    asking.current = true;
    void (async () => {
      const ok = await openDialog({
        kind: "confirm",
        icon: "info",
        title: t("door.consent.title"),
        bodyNode: (
          <>
            <p>{t(hasTerms && hasPrivacy ? "door.consent.bodyBoth" : hasTerms ? "door.consent.bodyTerms" : "door.consent.bodyPrivacy")}</p>
            <p>
              <Trans
                t={t}
                i18nKey={hasTerms && hasPrivacy ? "door.consent.both" : hasTerms ? "door.consent.terms" : "door.consent.privacy"}
                components={{
                  // Plain links: dialogs render outside the router.
                  terms:   <a href={legalPath("terms")} target="_blank" rel="noreferrer" style={LINK} />,
                  privacy: <a href={legalPath("privacy")} target="_blank" rel="noreferrer" style={LINK} />,
                }}
              />
            </p>
          </>
        ),
        confirmText: t("door.consent.accept"),
        cancelText: t("door.consent.signOut"),
      });
      if (ok) {
        await api.post("/auth/legal-consent", {});
        const token = authStore.token;
        if (token && authStore.user) authStore.set(token, { ...authStore.user, needsLegalConsent: false });
      } else {
        try { await api.post("/auth/logout"); } catch { /* signed out locally either way */ }
        applyLogout();
      }
      asking.current = false;
    })();
  }, [user?.needsLegalConsent, hasTerms, hasPrivacy, t]);

  return null;
}
