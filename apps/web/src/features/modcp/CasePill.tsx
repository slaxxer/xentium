import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
import { caseIcon, caseReasonShort, caseTitle, humanizeSignal, severityLabel, type ModCase } from "./modData";
import { modStore } from "./modSession";

/**
 * 2b — a security case's pill, shown on a linked member's profile. The linked
 * accounts are chips (one click switches to that profile), the signals open upward
 * like the premade-text menu, then Allow or Ban all. Detection never acts on its own.
 */
export function CasePill({ c, position, total }: { c: ModCase; position: number; total: number }) {
  const { t } = useTranslation("common", { keyPrefix: "modcanvas.case" });
  const { t: tc } = useTranslation("common", { keyPrefix: "modcanvas.common" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [signalsOpen, setSignalsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewing = decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)/)?.[1] ?? "");

  const signals = [
    ...(Array.isArray(c.signals) ? c.signals : []).map((s) => ({ text: humanizeSignal(s), mono: false })),
    ...(c.ipAddresses ?? []).map((ip) => ({ text: t("ip", { ip }), mono: true })),
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
    onSuccess: () => done(t("allowed", { title: caseTitle(c.type) })),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const banAll = useMutation({
    mutationFn: () => api.post<{ userId: string; skipped: boolean }[]>(`/moderation/cases/${c.id}/ban-all`, {}),
    onSuccess: (results) => {
      const banned = results.filter((r) => !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      done(skipped ? t("bannedSkipped", { count: banned, skipped }) : t("banned", { count: banned }));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const confirmBan = async () => {
    const names = c.linkedUsers.map((u) => u.username).join(", ");
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("confirmTitle"),
      body: t("confirmBody", { names: names || t("everyLinked") }),
      confirmText: t("banAll"),
    });
    if (ok) banAll.mutate();
  };

  const busy = allow.isPending || banAll.isPending;

  return (
    <div className="mcp" role="region" aria-label={t("region")}>
      <div className="mcp__id">
        <span className={`mcp__ic${high ? " mcp__ic--danger" : ""}`}><FontAwesomeIcon icon={caseIcon(c.type)} /></span>
        <div className="mcp__idtext">
          <span className="mcp__title">
            {caseTitle(c.type)}
            <span className={`mcp__count${high ? "" : " mcp__count--neutral"}`}>{severityLabel(c.severity)}</span>
          </span>
          <span className="mcp__sub">{caseReasonShort(c.type)} · {timeAgo(c.createdAt)}</span>
        </div>
      </div>

      <span className="mcp__rule" />

      {c.linkedUsers.length > 0 && (
        <div className="mcp__seg" aria-label={t("accounts")}>
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
            <div className="mcp-menu__head">{t("signals")}</div>
            <ul className="mcp-menu__signals">
              {signals.map((s, i) => (
                <li key={i}><FontAwesomeIcon icon={faTriangleExclamation} /> <span className={s.mono ? "is-mono" : ""}>{s.text}</span></li>
              ))}
              {signals.length === 0 && <li>{t("noSignals")}</li>}
            </ul>
            <div className="mcp-menu__foot">{t("signalsFoot")}</div>
          </div>
        )}
        <button type="button" className="mcp__pick" aria-expanded={signalsOpen} onClick={() => setSignalsOpen((v) => !v)}>
          <FontAwesomeIcon icon={faTriangleExclamation} className="mcp__pick-muted" />
          <span>{t("signalCount", { count: signals.length })}</span>
          <FontAwesomeIcon icon={faChevronUp} className="mcp__pick-chev" />
        </button>
      </div>

      <button type="button" className="mcp-send mcp-send--ghost" disabled={busy} onClick={() => allow.mutate()}>
        <FontAwesomeIcon icon={faUserCheck} /> {t("allow")}
      </button>
      <button type="button" className="mcp-send mcp-send--danger" disabled={busy || c.linkedUsers.length === 0} onClick={confirmBan}>
        <FontAwesomeIcon icon={faBan} /> {t("banAll")}
      </button>

      <span className="mcp__rule" />
      <span className="mcp__pos">{position + 1}/{total}</span>
      <button type="button" className="mcp__round" aria-label={t("next")} disabled={position + 1 >= total}
        onClick={() => modStore.go(position + 1)}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
      <button type="button" className="mcp__round" aria-label={tc("close")} onClick={modStore.close}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}
