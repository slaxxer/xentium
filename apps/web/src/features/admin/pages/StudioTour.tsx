/**
 * Theme Studio's first-visit tour: a short walk over the REAL controls, one at a
 * time, with the rest of the screen dimmed. Shown once per admin (the server-side
 * UI flag `tour:theme-studio`) and replayable from the "?" button in the editor.
 *
 * One step is a task, not a slide: "click something on the page" waits until a
 * block IS selected, because selecting is the one thing the whole editor builds on.
 * Nothing in the tour edits the page; anything an admin tries along the way is an
 * ordinary edit, undone with Ctrl+Z like any other.
 *
 * Own primitives, no tour library: a spotlight box (its giant shadow is the dim)
 * and a card placed beside it, re-measured while the step is open so it follows a
 * scrolling or resizing editor.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./StudioTour.scss";
import { Button } from "../../../components/AcpControls";

interface Step {
  id: string;
  /** What to point at; absent = a centred card. */
  target?: string;
  /** For a task step: true once it is done. */
  done?: () => boolean;
}

export function StudioTour({ open, hasSelection, onClose }: {
  open: boolean;
  hasSelection: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("acp", { keyPrefix: "layoutEditor.tour" });
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);

  const steps: Step[] = [
    { id: "welcome" },
    { id: "modes",   target: ".studio__modes" },
    { id: "page",    target: ".lay__doc" },
    { id: "add",     target: ".lay__rail" },
    { id: "select",  target: ".lay__stage", done: () => hasSelection },
    { id: "panel",   target: ".lay__inspector" },
    // The step id is the old Simple/Advanced one; it now points at the change count.
    { id: "mode",    target: ".lay__changes" },
    { id: "publish", target: ".studio__publish" },
    { id: "done" },
  ];
  const step = steps[Math.min(i, steps.length - 1)]!;
  const last = i === steps.length - 1;
  const blocked = !!step.done && !step.done();

  useEffect(() => { if (open) setI(0); }, [open]);

  // Follow the target while the step is open: the editor scrolls, panels change size.
  useLayoutEffect(() => {
    if (!open || !step.target) { setBox(null); return; }
    const measure = () => {
      const el = document.querySelector(step.target!);
      setBox(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [open, step.target]);

  // Escape skips, arrows step — the tour is keyboard-complete.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !blocked && !last) setI((n) => n + 1);
      if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, blocked, last, i, onClose]);

  if (!open) return null;

  const PAD = 6;
  const spot = box && {
    top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2,
  };
  // The card goes beside the target where there is room, else under it, else centred.
  const card: React.CSSProperties = !spot ? {} : (() => {
    const W = 340;
    const right = spot.left + spot.width + 16;
    if (right + W < window.innerWidth) return { top: Math.max(16, Math.min(spot.top, window.innerHeight - 260)), left: right };
    const below = spot.top + spot.height + 12;
    if (below + 220 < window.innerHeight) return { top: below, left: Math.max(16, Math.min(spot.left, window.innerWidth - W - 16)) };
    return { top: Math.max(16, spot.top - 232), left: Math.max(16, Math.min(spot.left, window.innerWidth - W - 16)) };
  })();

  return createPortal(
    <div className={`studio-tour${spot ? "" : " studio-tour--centre"}`} role="dialog" aria-modal="true"
      aria-label={t("label")}>
      {spot ? <div className="studio-tour__spot" style={spot} /> : <div className="studio-tour__dim" />}
      <div className="studio-tour__card" style={card}>
        <div className="studio-tour__count">{t("count", { n: i + 1, total: steps.length })}</div>
        <h3>{t(`${step.id}.title`)}</h3>
        <p>{t(`${step.id}.body`)}</p>
        {blocked && <p className="studio-tour__task">{t(`${step.id}.task`)}</p>}
        <div className="studio-tour__acts">
          {!last && <Button variant="ghost" onClick={onClose}>{t("skip")}</Button>}
          <span className="studio-tour__gap" />
          {i > 0 && !last && (
            <Button variant="ghost" onClick={() => setI((n) => n - 1)}>{t("back")}</Button>
          )}
          <Button disabled={blocked}
            onClick={() => (last ? onClose() : setI((n) => n + 1))}>
            {last ? t("finish") : i === 0 ? t("start") : t("next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
