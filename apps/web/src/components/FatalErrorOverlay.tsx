import { useState } from "react";
import { FontAwesomeIcon } from "./Icon";
import { faTriangleExclamation, faCopy, faCheck, faRotateRight, faBookOpen } from "@fortawesome/free-solid-svg-icons";
import { useFatalError } from "../lib/fatalError";
import "./FatalErrorOverlay.scss";

/**
 * WoltLab-style fatal halt. Rendered once at the app root; when a server-class
 * error (HTTP >= 500) trips the fatal store, this takes over the whole screen
 * and blocks all interaction. Recovery is a deliberate reload — the admin is
 * expected to copy the XEC code and look it up in ACP → Error Reference.
 */
export function FatalErrorOverlay() {
  const fatal = useFatalError();
  const [copied, setCopied] = useState(false);

  if (!fatal) return null;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(fatal.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is shown on screen regardless */
    }
  };

  return (
    <div className="fatal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="fatal-title">
      <div className="fatal-overlay__card">
        <div className="fatal-overlay__icon">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>

        <h1 id="fatal-title" className="fatal-overlay__title">Something went wrong</h1>
        <p className="fatal-overlay__lead">
          The server hit an unexpected error and the page can’t continue safely.
          Copy the error code below and look it up in the Error Reference for the
          cause and a suggested fix.
        </p>

        <div className="fatal-overlay__code-row">
          <code className="fatal-overlay__code">{fatal.code}</code>
          <button type="button" className="fatal-overlay__copy" onClick={copyCode} aria-label="Copy error code">
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <div className="fatal-overlay__actions">
          <a
            className="fatal-overlay__btn fatal-overlay__btn--primary"
            href={`/admin/error-ref?code=${encodeURIComponent(fatal.code)}`}
          >
            <FontAwesomeIcon icon={faBookOpen} /> Look up in Error Reference
          </a>
          <button
            type="button"
            className="fatal-overlay__btn fatal-overlay__btn--ghost"
            onClick={() => window.location.reload()}
          >
            <FontAwesomeIcon icon={faRotateRight} /> Reload page
          </button>
        </div>

        <p className="fatal-overlay__hint">
          Error Reference lives in <strong>ACP → System → Error Reference</strong>.
          This incident has also been recorded in the Error Log.
        </p>
      </div>
    </div>
  );
}
