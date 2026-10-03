import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  faBan, faChevronRight, faChevronUp, faTriangleExclamation, faUserCheck, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { UserAvatar } from "../../components/UserAvatar";
import { api } from "../../lib/api";
import { toast } from "../../lib/toast";
import { openDialog } from "../../lib/dialog";
import { apiErrorMessage } from "../../lib/swal";
import { timeAgo } from "../../lib/time";
import { caseIcon, caseReasonShort, caseTitle, humanizeSignal, type ModCase } from "./modData";
import { modStore } from "./modSession";

/**
 * 2b — a security case's pill, shown on a linked member's profile. The linked
 * accounts are chips (one click switches to that profile), the signals open upward
 * like the premade-text menu, then Allow or Ban all. Detection never acts on its own.
 */
export function CasePill({ c, position, total }: { c: ModCase; position: number; total: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [signalsOpen, setSignalsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewing = decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)/)?.[1] ?? "");

  const signals = [
    ...(Array.isArray(c.signals) ? c.signals : []).map(humanizeSignal),
    ...(c.ipAddresses ?? []).map((ip) => `IP: ${ip}`),
  ];
  const high = c.severity === "high";

  useEffect(() => {
    if (!signalsOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setSignalsOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSignalsOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [signalsOpen]);

  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["canvas-cases"] });
    qc.invalidateQueries({ queryKey: ["mod-summary"] });
    modStore.go(position + 1);
  };

  const allow = useMutation({
    mutationFn: () => api.patch(`/moderation/cases/${c.id}`, { status: "reviewed" }),
    onSuccess: () => done(`${caseTitle(c.type)} allowed`),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const banAll = useMutation({
    mutationFn: () => api.post<{ userId: string; skipped: boolean }[]>(`/moderation/cases/${c.id}/ban-all`, {}),
    onSuccess: (results) => {
      const banned = results.filter((r) => !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      done(`Banned ${banned}${skipped ? `, ${skipped} skipped` : ""}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const confirmBan = async () => {
    const names = c.linkedUsers.map((u) => u.username).join(", ");
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: "Ban all linked accounts?",
      body: `${names || "Every linked account"} will be banned and signed out. Staff and accounts already banned are skipped.`,
      confirmText: "Ban all",
    });
    if (ok) banAll.mutate();
  };

  const busy = allow.isPending || banAll.isPending;

  return (
    <div className="mcp" role="region" aria-label="Security case actions">
      <div className="mcp__id">
        <span className={`mcp__ic${high ? " mcp__ic--danger" : ""}`}><FontAwesomeIcon icon={caseIcon(c.type)} /></span>
        <div className="mcp__idtext">
          <span className="mcp__title">
            {caseTitle(c.type)}
            <span className={`mcp__count${high ? "" : " mcp__count--neutral"}`}>{c.severity}</span>
          </span>
          <span className="mcp__sub">{caseReasonShort(c.type)} · {timeAgo(c.createdAt)}</span>
        </div>
      </div>

      <span className="mcp__rule" />

      {c.linkedUsers.length > 0 && (
        <div className="mcp__seg" aria-label="Linked accounts">
          {c.linkedUsers.map((u) => (
            <button key={u.id} type="button" className={`mcp__user${viewing.toLowerCase() === u.username.toLowerCase() ? " is-on" : ""}`}
              onClick={() => navigate(`/u/${encodeURIComponent(u.username)}`)}>
              <UserAvatar user={{ username: u.username, avatar: null }} size={24} />
              {u.username}
            </button>
          ))}
        </div>
      )}

      <div className="mcp__menuwrap" ref={menuRef}>
        {signalsOpen && (
          <div className="mcp-menu mcp-menu--narrow">
            <div className="mcp-menu__head">Signals</div>
            <ul className="mcp-menu__signals">
              {signals.map((s, i) => (
                <li key={i}><FontAwesomeIcon icon={faTriangleExclamation} /> <span className={s.startsWith("IP: ") ? "is-mono" : ""}>{s}</span></li>
              ))}
              {signals.length === 0 && <li>No signals were recorded.</li>}
            </ul>
            <div className="mcp-menu__foot">Detection never acts on its own. Allow records an exception, and Ban all bans every linked account.</div>
          </div>
        )}
        <button type="button" className="mcp__pick" aria-expanded={signalsOpen} onClick={() => setSignalsOpen((v) => !v)}>
          <FontAwesomeIcon icon={faTriangleExclamation} className="mcp__pick-muted" />
          <span>{signals.length} signal{signals.length === 1 ? "" : "s"}</span>
          <FontAwesomeIcon icon={faChevronUp} className="mcp__pick-chev" />
        </button>
      </div>

      <button type="button" className="mcp-send mcp-send--ghost" disabled={busy} onClick={() => allow.mutate()}>
        <FontAwesomeIcon icon={faUserCheck} /> Allow
      </button>
      <button type="button" className="mcp-send mcp-send--danger" disabled={busy || c.linkedUsers.length === 0} onClick={confirmBan}>
        <FontAwesomeIcon icon={faBan} /> Ban all
      </button>

      <span className="mcp__rule" />
      <span className="mcp__pos">{position + 1}/{total}</span>
      <button type="button" className="mcp__round" aria-label="Next case" disabled={position + 1 >= total}
        onClick={() => modStore.go(position + 1)}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
      <button type="button" className="mcp__round" aria-label="Close" onClick={modStore.close}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}
