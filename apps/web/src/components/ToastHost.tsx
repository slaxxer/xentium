import { useSyncExternalStore } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faCircleCheck, faCircleInfo, faTriangleExclamation, faCircleXmark, faXmark } from "@fortawesome/free-solid-svg-icons";
import { subscribeToasts, getToasts, getToastCategoryDef, toast, type ToastItem } from "../lib/toast";
import "./ToastHost.scss";

// Renders the toast stack (top-right). Mounted once in the app root. Colors
// resolve --toast-<category> → the semantic feedback tokens, so the Style
// Editor's Feedback section themes toasts live; custom plugin categories carry
// their registered color/icon and otherwise render as info.

const CORE_ICONS: Record<string, IconDefinition> = {
  success: faCircleCheck,
  info:    faCircleInfo,
  warning: faTriangleExclamation,
  error:   faCircleXmark,
};

function categoryPresentation(t: ToastItem): { icon: IconDefinition; color?: string; core: boolean } {
  if (CORE_ICONS[t.category]) return { icon: CORE_ICONS[t.category]!, core: true };
  const def = getToastCategoryDef(t.category);
  return { icon: (def?.icon as IconDefinition) ?? faCircleInfo, color: def?.color, core: false };
}

function ToastCard({ t }: { t: ToastItem }) {
  const { icon, color, core } = categoryPresentation(t);
  const assertive = t.category === "warning" || t.category === "error";
  return (
    <div
      className={`nv-toast${core ? ` nv-toast--${t.category}` : " nv-toast--info"}${t.paused ? " is-paused" : ""}`}
      style={color ? ({ "--_toast-c": color } as React.CSSProperties) : undefined}
      role={assertive ? "alert" : "status"}
      onMouseEnter={() => toast.pause(t.id)}
      onMouseLeave={() => toast.resume(t.id)}
    >
      <span className="nv-toast__icon"><FontAwesomeIcon icon={icon} /></span>
      <div className="nv-toast__body">
        {t.title && <div className="nv-toast__title">{t.title}</div>}
        <div className="nv-toast__msg">{t.message}</div>
        {t.action && (
          <button type="button" className="nv-toast__action" onClick={() => { t.action!.onClick(); toast.dismiss(t.id); }}>
            {t.action.label}
          </button>
        )}
      </div>
      {t.count > 1 && <span className="nv-toast__count">×{t.count}</span>}
      <button type="button" className="nv-toast__close" aria-label="Dismiss" onClick={() => toast.dismiss(t.id)}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
      {/* key restarts the countdown animation when a dedup resets the timer */}
      <span key={`${t.id}:${t.count}`} className="nv-toast__progress" style={{ animationDuration: `${t.duration}ms` }} />
    </div>
  );
}

export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="nv-toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => <ToastCard key={t.id} t={t} />)}
    </div>
  );
}
