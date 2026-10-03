import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faChevronRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { toast } from "../../lib/toast";
import { openDialog } from "../../lib/dialog";
import { apiErrorMessage } from "../../lib/swal";
import { timeAgo } from "../../lib/time";
import type { ModQueueAction, ModQueueItem, ModQueueSlot } from "../../plugins/slotRegistry";
import { modStore } from "./modSession";

const TONE: Record<NonNullable<ModQueueAction["tone"]>, string> = {
  primary: "mcp-send--primary",
  danger:  "mcp-send--danger",
  ghost:   "mcp-send--ghost",
};

/** A confirm dialog's text body plus a required reason. */
function ReasonField({ body, label, onChange }: { body: string; label: string; onChange: (v: string) => void }) {
  return (
    <div className="mcp-reason">
      <p>{body}</p>
      <label>
        <span>{label}</span>
        <textarea rows={3} maxLength={500} autoFocus onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

/**
 * The pill for one item of a plugin's queue (e.g. a thread awaiting approval). Same
 * shape as the report and case pills — what it is, the plugin's actions, then the
 * position and next/close — so every kind of waiting work is handled the same way.
 */
export function QueuePill({ queue, item, position, total }: {
  queue: ModQueueSlot; item: ModQueueItem; position: number; total: number;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: ModQueueAction) => {
    let reason: string | undefined;
    if (action.confirm) {
      // The reason is read from the field when the dialog confirms, not held in state:
      // the dialog renders outside this component.
      const typed = { value: "" };
      const ok = await openDialog({
        kind: "confirm", icon: "warning", danger: action.tone === "danger",
        title: action.confirm.title, confirmText: action.label,
        ...(action.confirm.reasonLabel
          ? { bodyNode: <ReasonField body={action.confirm.body} label={action.confirm.reasonLabel} onChange={(v) => { typed.value = v; }} /> }
          : { body: action.confirm.body }),
      });
      if (!ok) return;
      if (action.confirm.reasonLabel) {
        reason = typed.value.trim();
        if (!reason) { toast.error(action.confirm.reasonLabel); return; }
      }
    }
    setBusy(action.id);
    try {
      const msg = await action.run(item, reason);
      if (msg) toast.success(msg);
      await qc.invalidateQueries({ queryKey: ["mod-queue", queue.id] });
      modStore.go(position + 1);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mcp" role="region" aria-label={`${queue.label} actions`}>
      <div className="mcp__id">
        <span className={`mcp__ic${item.hot ? " mcp__ic--danger" : ""}`}><FontAwesomeIcon icon={queue.icon as IconProp} /></span>
        <div className="mcp__idtext">
          <span className="mcp__title">
            <span className="mcp__titletext">{item.title}</span>
            <span className="mcp__count mcp__count--neutral">{queue.label}</span>
          </span>
          <span className="mcp__sub">{item.line ? `${item.line} · ` : ""}{timeAgo(item.createdAt)}</span>
        </div>
      </div>

      <span className="mcp__rule" />

      {queue.actions.map((a) => (
        <button key={a.id} type="button" className={`mcp-send ${TONE[a.tone ?? "ghost"]}`} disabled={!!busy} onClick={() => void run(a)}>
          {a.icon ? <FontAwesomeIcon icon={a.icon as IconProp} /> : null} {busy === a.id ? "Working…" : a.label}
        </button>
      ))}

      <span className="mcp__rule" />
      <span className="mcp__pos">{position + 1}/{total}</span>
      <button type="button" className="mcp__round" aria-label="Next" disabled={position + 1 >= total}
        onClick={() => modStore.go(position + 1)}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
      <button type="button" className="mcp__round" aria-label="Close" onClick={modStore.close}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}
