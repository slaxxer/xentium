import { useEffect, useRef, useSyncExternalStore } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faCircleQuestion, faCircleCheck, faCircleInfo, faTriangleExclamation, faCircleXmark, faCloudArrowDown } from "@fortawesome/free-solid-svg-icons";
import { subscribeDialog, getDialog, resolveDialog, type DialogIcon } from "../lib/dialog";
import "./DialogHost.scss";

// Renders the active confirm/alert dialog (lib/dialog.ts). Mounted once in the
// app root. Escape cancels, Enter confirms, confirm button autofocuses.

const ICONS: Record<DialogIcon, IconDefinition> = {
  question: faCircleQuestion,
  success:  faCircleCheck,
  info:     faCircleInfo,
  warning:  faTriangleExclamation,
  error:    faCircleXmark,
  update:   faCloudArrowDown,
};

export function DialogHost() {
  const dialog = useSyncExternalStore(subscribeDialog, getDialog, getDialog);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const isProgress = dialog?.kind === "progress";
  const prog = dialog?.progress;
  const running = isProgress && prog?.status === "running";

  useEffect(() => {
    if (!dialog) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (running) return; // a running progress dialog can't be dismissed
      if (e.key === "Escape") resolveDialog(false);
      if (e.key === "Enter")  resolveDialog(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog?.id, running]);

  if (!dialog) return null;
  // A progress dialog reflects its outcome in the icon once finished.
  const effIcon: DialogIcon = isProgress
    ? (prog?.status === "success" ? "success" : prog?.status === "error" ? "error" : dialog.icon)
    : dialog.icon;
  const isDanger = dialog.danger || effIcon === "error";

  return (
    <div className="nv-dialog-overlay" onMouseDown={(e) => { if (!running && e.target === e.currentTarget) resolveDialog(false); }}>
      <div className={`nv-dialog nv-dialog--${effIcon}${dialog.wide ? " nv-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-label={dialog.title}>
        {dialog.wide ? (
          <div className="nv-dialog__head">
            <span className="nv-dialog__icon"><FontAwesomeIcon icon={ICONS[effIcon]} /></span>
            <h2 className="nv-dialog__title">{dialog.title}</h2>
            {dialog.badge && <span className="nv-dialog__badge">{dialog.badge}</span>}
          </div>
        ) : (
          <>
            <span className="nv-dialog__icon"><FontAwesomeIcon icon={ICONS[effIcon]} /></span>
            <h2 className="nv-dialog__title">{dialog.title}</h2>
          </>
        )}

        {isProgress && prog && (
          <div className="nv-dialog__progress">
            <div className={`nv-dialog__bar nv-dialog__bar--${prog.status}`}>
              <div className="nv-dialog__bar-fill" style={{ width: `${prog.percent}%` }} />
            </div>
            <div className="nv-dialog__progress-row">
              <span className="nv-dialog__progress-msg">{prog.message}</span>
              {prog.status === "running" && <span className="nv-dialog__progress-pct">{prog.percent}%</span>}
            </div>
          </div>
        )}
        {(dialog.bodyNode ?? dialog.body) && (
          <div className="nv-dialog__body">{dialog.bodyNode ?? dialog.body}</div>
        )}
        {dialog.rows && dialog.rows.length > 0 && (
          <ul className="nv-dialog__rows">
            {dialog.rows.map((row, i) => (
              <li key={i} className="nv-dialog__row">
                <span className="nv-dialog__row-label">{row.label}</span>
                {row.marker && <span className="nv-dialog__row-marker">{row.marker}</span>}
                {row.value && <span className="nv-dialog__row-value">{row.value}</span>}
              </li>
            ))}
          </ul>
        )}
        {dialog.note && <div className="nv-dialog__note">{dialog.note}</div>}
        {/* A running progress dialog shows no actions; once done it gets a Close. */}
        {!running && (
          <div className="nv-dialog__actions">
            {isProgress ? (
              <button
                ref={confirmRef} type="button"
                className={`nv-dialog__btn nv-dialog__btn--primary${isDanger ? " is-danger" : ""}`}
                onClick={() => resolveDialog(true)}
              >
                {dialog.confirmText ?? "Close"}
              </button>
            ) : (
              <>
                {dialog.kind === "confirm" && (
                  <button type="button" className="nv-dialog__btn nv-dialog__btn--ghost" onClick={() => resolveDialog(false)}>
                    {dialog.cancelText ?? "Cancel"}
                  </button>
                )}
                <button
                  ref={confirmRef} type="button"
                  className={`nv-dialog__btn nv-dialog__btn--primary${isDanger ? " is-danger" : ""}`}
                  onClick={() => resolveDialog(true)}
                >
                  {dialog.confirmText ?? "OK"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
