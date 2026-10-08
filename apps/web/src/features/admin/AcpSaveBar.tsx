/**
 * The ACP save bar: one per ACP page, mounted by the shell. It appears as soon as any
 * settings surface on the page has an unsaved change (`useDraft`), adds them all up,
 * and makes the admin Save or Discard before anything goes live.
 *
 * Leaving the page with unsaved changes is caught here too — not with a dialog: the
 * bar turns into "Save before you leave?" and shakes. Switching sections WITHIN a page
 * (System Settings' section nav) is not leaving, and is never caught.
 *
 * ⌘S / Ctrl+S saves; Esc closes the review list or answers "Stay".
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";
import { AcpIcon } from "./pages/acpIcons";
import { discardAll, saveAll, useDraftStore, useSaveBarMounted } from "../../hooks/useDraft";
import "./AcpSaveBar.scss";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function AcpSaveBar() {
  useSaveBarMounted();
  const { t } = useTranslation("acp");
  const store = useDraftStore();
  const { dirtyCount, changes, status, error } = store;
  const [review, setReview] = useState(false);
  const [shake, setShake] = useState(0);
  const dirty = dirtyCount > 0;

  // ── Leaving the page ────────────────────────────────────────────────────────
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  const guard = blocker.state === "blocked";
  useEffect(() => { if (guard) setShake((n) => n + 1); }, [guard]);
  // Nothing left to lose (saved, discarded, reverted): let the navigation through.
  useEffect(() => { if (guard && !dirty && status !== "saving") blocker.proceed?.(); }, [guard, dirty, status, blocker]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  // A failed save shakes the bar, like an attempt to leave.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status === "error" && prevStatus.current !== "error") setShake((n) => n + 1);
    prevStatus.current = status;
  }, [status]);

  useEffect(() => { if (!dirty) setReview(false); }, [dirty]);

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (!dirtyRef.current) return;
        e.preventDefault();
        void saveAll();
      } else if (e.key === "Escape") {
        if (blocker.state === "blocked") blocker.reset?.();
        setReview(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocker]);

  // ── Lined up with the content column, whatever the nav is doing ─────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = document.querySelector<HTMLElement>(".acp-content");
    const wrap = wrapRef.current;
    if (!content || !wrap) return;
    const place = () => {
      const r = content.getBoundingClientRect();
      wrap.style.left = `${r.left}px`;
      wrap.style.width = `${r.width}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(content);
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); window.removeEventListener("resize", place); };
  }, []);

  const saving = status === "saving";
  const visible = dirty || saving || status === "saved" || status === "error";
  const failed = status === "error" && error;

  const title = guard ? t("savebar.guardTitle")
    : saving ? t("savebar.saving", { count: dirtyCount })
    : failed ? t("savebar.failed", { count: dirtyCount })
    : status === "saved" && !dirty ? t("savebar.saved")
    : t("savebar.unsaved", { count: dirtyCount });
  const failedLabel = failed && error.field ? changes.find((c) => c.key === error.field)?.label : undefined;
  const sub = guard ? t("savebar.guardSub", { count: dirtyCount })
    : failed ? [error.code, [failedLabel, error.message].filter(Boolean).join(": ")].filter(Boolean).join(" · ")
    : dirty && !saving ? t("savebar.sub") : "";

  const indicator = saving ? "spin" : failed ? "danger" : status === "saved" && !dirty ? "success" : "warn";


  return (
    <div ref={wrapRef} className={`acp-savebar${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
      <div key={shake} className={`acp-savebar__bar${shake ? " is-shaking" : ""}`} role="region" aria-label={t("savebar.region")}>
        {review && changes.length > 0 && (
          <div className="acp-savebar__review">
            <p className="acp-savebar__review-label">{t("savebar.reviewTitle")}</p>
            <ul>
              {changes.map((c, i) => (
                <li key={`${c.key}-${i}`} className={failed && error.field === c.key ? "is-error" : ""}>
                  <div className="acp-savebar__item">
                    <p>
                      <strong>{c.label || t("savebar.unlabelled")}</strong>
                      {c.section && <span> · {c.section}</span>}
                    </p>
                    {(c.from || c.to) && (
                      <p className="acp-savebar__diff">
                        <s>{c.from || t("savebar.empty")}</s>
                        <AcpIcon name="arrowRight" size={13} />
                        <em>{c.to || t("savebar.empty")}</em>
                      </p>
                    )}
                  </div>
                  {c.revert && (
                    <button type="button" className="acp-savebar__revert" onClick={c.revert} disabled={saving}>
                      {t("savebar.revert")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="acp-savebar__row">
          <span className={`acp-savebar__ind is-${indicator}`} aria-hidden="true" />
          <div className="acp-savebar__text" aria-live="polite">
            <p className="acp-savebar__title">{title}</p>
            {sub && <p className="acp-savebar__sub">{sub}</p>}
          </div>

          {dirty && !guard && (
            <button type="button" className="acp-savebar__review-btn" aria-expanded={review}
              onClick={() => setReview((v) => !v)}>
              {t("savebar.review")}
              <AcpIcon name="chevron" size={15} style={{ transform: review ? undefined : "rotate(180deg)" }} />
            </button>
          )}

          {dirty && (
            <button type="button" className="acp-savebar__ghost" disabled={saving}
              // When leaving was blocked, clean = the navigation goes through (effect above).
              onClick={() => discardAll()}>
              {guard ? t("savebar.discardLeave") : t("savebar.discard")}
            </button>
          )}

          {dirty && (
            <button type="button" className={`btn-primary acp-savebar__save${saving ? " is-saving" : ""}`}
              disabled={saving} onClick={() => void saveAll()}>
              {saving ? <><span className="savechip__spin" />{t("savebar.savingShort")}</>
                : guard ? t("savebar.saveLeave")
                : failed ? t("savebar.retry")
                : <>{t("savebar.save")}<kbd>{isMac ? "⌘S" : "Ctrl S"}</kbd></>}
            </button>
          )}

          {guard && (
            <button type="button" className="acp-savebar__stay" aria-label={t("savebar.stay")} title={t("savebar.stay")}
              onClick={() => blocker.reset?.()}>
              <AcpIcon name="x" size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
