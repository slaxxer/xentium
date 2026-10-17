/**
 * A placeholder for content from another site (a video, a map) until the visitor
 * agrees to that category. Loading it would hand the visitor's IP address to the
 * other site, so nothing is requested before consent: the "two-click" solution.
 *
 *   <ConsentGate category="media" service="YouTube"><iframe … /></ConsentGate>
 *
 * "Load" shows it this once; "Always allow" (offered when a consent plugin is
 * active) grants the category, which also lifts every other gate of that category.
 * A host global (`webConsentGate`) for plugins that embed third-party content.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { grantConsent, useConsent, useHasConsentProvider, type ConsentCategory } from "../lib/consent";
import "./ConsentGate.scss";

export function ConsentGate({ category = "media", service, privacyUrl, children }: {
  category?: ConsentCategory;
  /** Who the content comes from: "YouTube", "OpenStreetMap"… */
  service: string;
  privacyUrl?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("common", { keyPrefix: "consent.gate" });
  const allowed = useConsent(category);
  const provider = useHasConsentProvider();
  const [once, setOnce] = useState(false);
  if (allowed || once) return <>{children}</>;
  return (
    <div className="xt-consent-gate" role="group" aria-label={t("title", { service })}>
      <b>{t("title", { service })}</b>
      <p>
        {t("body", { service })}
        {privacyUrl && <> <a href={privacyUrl} target="_blank" rel="noreferrer">{t("privacy")}</a></>}
      </p>
      <div className="xt-consent-gate__acts">
        <button type="button" className="btn-primary btn-sm" onClick={() => setOnce(true)}>{t("loadOnce")}</button>
        {provider && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => grantConsent(category)}>{t("always")}</button>
        )}
      </div>
    </div>
  );
}
