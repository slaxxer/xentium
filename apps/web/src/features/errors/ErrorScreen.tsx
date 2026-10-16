import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faTriangleExclamation, faArrowsRotate, faRotateRight, faHouse, faArrowLeft,
  faCopy, faCheck, faBookOpen, faListUl,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { formatReport, type ClientErrorReport } from "../../lib/clientErrors";
import "./ErrorScreen.scss";
import { uiLocale } from "../../lib/i18n";

/** A chunk failure auto-reloads at most once a minute — a missing bundle that
 *  stays missing (a broken deploy) must not put the tab in a reload loop. */
const AUTO_RELOAD_KEY  = "nv.chunkReloadAt";
const AUTO_RELOAD_SECS = 5;

function autoReloadAllowed(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0) > 60_000;
  } catch {
    return false; // storage blocked → never auto-reload
  }
}

export interface ErrorScreenProps {
  report: ClientErrorReport;
  /** `full` takes the viewport (no chrome around it); `inline` sits inside a
   *  layout that survived, so the nav and footer stay usable. */
  variant?: "full" | "inline";
  /** Re-render the failed subtree without a document reload, when the caller
   *  has a way to do that (a boundary reset, a route replace). */
  onRetry?: () => void;
}

/**
 * The screen a user sees when the app itself broke.
 *
 * Three jobs, in order: tell them in plain language what happened and that
 * their data is fine, give them a way out that is likely to work, and put a
 * quotable reference plus a copyable diagnostic report in their hands so the
 * incident can actually be chased. Stack traces are for admins and dev builds —
 * a visitor gets the reference, not the internals.
 */
export function ErrorScreen({ report, variant = "full", onRetry }: ErrorScreenProps) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const isAdmin     = userCan(user, "admin.access");
  const showDetails = isAdmin || import.meta.env.DEV;
  const isChunk     = report.kind === "chunk";

  // Stale-bundle recovery: a visible countdown rather than a surprise reload,
  // with a cancel — the user stays in charge of their own tab.
  const [countdown, setCountdown] = useState<number | null>(
    isChunk && autoReloadAllowed() ? AUTO_RELOAD_SECS : null,
  );

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      try { sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
      window.location.reload();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(formatReport(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the reference is on screen and the details expand */
    }
  };

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  const copy = isChunk
    ? {
        icon:    faArrowsRotate,
        eyebrow: t("errorPage.eyebrowChunk", { defaultValue: "New version available" }),
        title:   t("errorPage.titleChunk",   { defaultValue: "This tab is running an older build." }),
        lead:    t("errorPage.leadChunk",    { defaultValue: "Part of the site failed to load because it was updated while this tab was open. Reloading picks up the new version — nothing is lost." }),
      }
    : report.status
      ? {
          icon:    faTriangleExclamation,
          eyebrow: t("errorPage.eyebrowHttp", { defaultValue: "Request failed" }),
          title:   t("errorPage.titleHttp",   { defaultValue: "The server couldn’t deliver this page." }),
          lead:    t("errorPage.leadHttp",    { status: report.status, defaultValue: "The server answered with {{status}}, so this page could not be built. It may be temporary — trying again is worth a shot." }),
        }
      : {
          icon:    faTriangleExclamation,
          eyebrow: t("errorPage.eyebrow", { defaultValue: "Unexpected error" }),
          title:   t("errorPage.title",   { defaultValue: "This page ran into a problem." }),
          lead:    t("errorPage.lead",    { defaultValue: "Something on this page crashed while it was rendering, so we stopped here instead of showing you a broken screen. Your account and your data are untouched." }),
        };

  const ghost = report.status ? String(report.status) : isChunk ? "NEW" : "ERR";

  return (
    <div className={`xt-err xt-err--${variant}${isChunk ? " xt-err--chunk" : ""}`} role="alert">
      {variant === "full" && <div className="xt-err__ghost" aria-hidden="true">{ghost}</div>}

      <div className="xt-err__content">
        <span className="xt-err__eyebrow">
          <FontAwesomeIcon icon={copy.icon} />
          {copy.eyebrow}
        </span>

        <h1 className="xt-err__h1">{copy.title}</h1>
        <p className="xt-err__lead">{copy.lead}</p>

        {countdown !== null && (
          <p className="xt-err__countdown">
            <FontAwesomeIcon icon={faArrowsRotate} spin />
            {/* `secs`, not `count` — `count` would send i18next down the plural
                lookup and miss the key entirely. */}
            {t("errorPage.reloadingIn", { secs: countdown, defaultValue: "Reloading automatically in {{secs}}s" })}
            <button type="button" className="xt-err__link" onClick={() => setCountdown(null)}>
              {t("errorPage.cancelReload", { defaultValue: "Cancel" })}
            </button>
          </p>
        )}

        <div className="xt-err__ref">
          <span className="xt-err__ref-label">{t("errorPage.reference", { defaultValue: "Reference" })}</span>
          <code className="xt-err__ref-code">{report.reference}</code>
          {report.code && <code className="xt-err__ref-code xt-err__ref-code--nec">{report.code}</code>}
          <button type="button" className="xt-err__copy" onClick={copyReport}>
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
            {copied
              ? t("errorPage.copied", { defaultValue: "Copied" })
              : t("errorPage.copy",   { defaultValue: "Copy report" })}
          </button>
        </div>

        <div className="xt-err__actions">
          {isChunk ? (
            <button type="button" className="xt-err__btn xt-err__btn--primary" onClick={() => window.location.reload()}>
              <FontAwesomeIcon icon={faRotateRight} /> {t("errorPage.reloadNow", { defaultValue: "Reload now" })}
            </button>
          ) : (
            <>
              {onRetry && (
                <button type="button" className="xt-err__btn xt-err__btn--primary" onClick={onRetry}>
                  <FontAwesomeIcon icon={faArrowsRotate} /> {t("errorPage.retry", { defaultValue: "Try again" })}
                </button>
              )}
              <button
                type="button"
                className={`xt-err__btn ${onRetry ? "xt-err__btn--ghost" : "xt-err__btn--primary"}`}
                onClick={() => window.location.reload()}
              >
                <FontAwesomeIcon icon={faRotateRight} /> {t("errorPage.reload", { defaultValue: "Reload page" })}
              </button>
            </>
          )}

          <a className="xt-err__btn xt-err__btn--ghost" href="/">
            <FontAwesomeIcon icon={faHouse} /> {t("errorPage.home", { defaultValue: "Take me home" })}
          </a>
          <button type="button" className="xt-err__btn xt-err__btn--ghost" onClick={goBack}>
            <FontAwesomeIcon icon={faArrowLeft} /> {t("errorPage.back", { defaultValue: "Go back" })}
          </button>
        </div>

        {isAdmin && (
          <div className="xt-err__admin">
            <a className="xt-err__link" href="/admin/error-log">
              <FontAwesomeIcon icon={faListUl} /> {t("errorPage.errorLog", { defaultValue: "Open Error Log" })}
            </a>
            {report.code && (
              <a className="xt-err__link" href={`/admin/error-ref?code=${encodeURIComponent(report.code)}`}>
                <FontAwesomeIcon icon={faBookOpen} /> {t("errorPage.errorRef", { defaultValue: "Look up this code" })}
              </a>
            )}
          </div>
        )}

        {showDetails ? (
          <details className="xt-err__details">
            <summary>{t("errorPage.details", { defaultValue: "Technical details" })}</summary>
            <p className="xt-err__details-hint">
              {t("errorPage.detailsHint", { defaultValue: "Shown to administrators and in development builds only." })}
            </p>
            <dl className="xt-err__meta">
              <dt>{t("errorPage.metaRoute", { defaultValue: "Route" })}</dt>
              <dd>{report.route || "—"}</dd>
              <dt>{t("errorPage.metaTime", { defaultValue: "Time" })}</dt>
              <dd>{new Date(report.at).toLocaleString(uiLocale())}</dd>
              <dt>{t("errorPage.metaMessage", { defaultValue: "Message" })}</dt>
              <dd className="xt-err__meta-msg">{report.message}</dd>
            </dl>
            {report.stack && <pre className="xt-err__trace">{report.stack}</pre>}
            {report.componentStack && (
              <pre className="xt-err__trace xt-err__trace--component">{report.componentStack.trim()}</pre>
            )}
          </details>
        ) : (
          <p className="xt-err__hint">
            {t("errorPage.hint", {
              defaultValue:
                "If this keeps happening, send the reference above to an administrator — copying the report attaches everything they need to trace it.",
            })}
          </p>
        )}
      </div>

      {variant === "full" && (
        <footer className="xt-err__foot">
          <span>{t("errorPage.footLabel", { defaultValue: "Application error · Xentium" })}</span>
        </footer>
      )}
    </div>
  );
}
