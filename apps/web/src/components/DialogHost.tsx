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

  useEffect(() => {
    if (!dialog) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveDialog(false);
      if (e.key === "Enter")  resolveDialog(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog?.id]);

  if (!dialog) return null;
  const isDanger = dialog.danger || dialog.icon === "error";

  return (
    <div className="nv-dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) resolveDialog(false); }}>
      <div className={`nv-dialog nv-dialog--${dialog.icon}${dialog.wide ? " nv-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-label={dialog.title}>
        {dialog.wide ? (
          <div className="nv-dialog__head">
            <span className="nv-dialog__icon"><FontAwesomeIcon icon={ICONS[dialog.icon]} /></span>
            <h2 className="nv-dialog__title">{dialog.title}</h2>
            {dialog.badge && <span className="nv-dialog__badge">{dialog.badge}</span>}
          </div>
        ) : (
          <>
            <span className="nv-dialog__icon"><FontAwesomeIcon icon={ICONS[dialog.icon]} /></span>
            <h2 className="nv-dialog__title">{dialog.title}</h2>
          </>
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
        <div className="nv-dialog__actions">
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
        </div>
      </div>
    </div>
  );
}
