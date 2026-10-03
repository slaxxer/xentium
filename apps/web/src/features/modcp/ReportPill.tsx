import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBan, faCheck, faChevronRight, faChevronUp, faFlag, faMinus, faTrash,
  faTriangleExclamation, faWandMagicSparkles, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { api } from "../../lib/api";
import { toast } from "../../lib/toast";
import { apiErrorMessage } from "../../lib/swal";
import { useAuth } from "../../hooks/useAuth";
import {
  DURATIONS, DURATION_LABEL, DURATION_TEXT, MODES, MODE_LABEL, fill, suggest, typeLabel,
  type Duration, type Mode, type Template,
} from "./modTemplates";
import { topReason, type ReportGroup } from "./modData";
import { modStore } from "./modSession";

/** Long enough to reach for Undo; a plain success toast is gone in 3.5s. */
const UNDO_MS = 8000;

const MODE_ICON: Record<Mode, IconDefinition> = { warn: faTriangleExclamation, ban: faBan, delete: faTrash, dismiss: faMinus };

/** What goes with Remove or Dismiss when no premade text exists for it. The server
 *  wants a message for every action; warn and ban never fall back, they need a text. */
const FALLBACK: Record<Mode, string> = {
  warn: "", ban: "",
  delete: "Removed by a moderator.",
  dismiss: "Reviewed by a moderator. No action was needed.",
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
  || (t instanceof HTMLElement && t.isContentEditable);

/**
 * 1a — the action pill on reported content: what was reported, the four actions, a
 * premade text, then Send. The texts are READ here; admins write them in
 * ACP → Moderation → Templates.
 */
export function ReportPill({ group, position, total }: { group: ReportGroup; position: number; total: number }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.groups.some((g) => g.key === "admin") ?? false;
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["mod-templates"],
    queryFn: () => api.get("/moderation/templates"),
  });

  const author = group.author;
  const hasAuthor = !!author;
  const count = group.reports.length;
  const type = typeLabel(group.targetType, group.targetId);
  const suggestion = useMemo(() => suggest(templates, group.reports.map((r) => r.reason), hasAuthor), [templates, group, hasAuthor]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const effMode: Mode = mode ?? suggestion?.mode ?? (hasAuthor ? "warn" : "dismiss");
  const inMode = templates.filter((t) => t.mode === effMode);
  const template = inMode.find((t) => t.id === templateId)
    ?? (suggestion?.mode === effMode ? suggestion : null)
    ?? inMode[0] ?? null;
  const effDuration: Duration = duration ?? template?.defaultDuration ?? "7d";
  const vars = {
    user: author?.username ?? "member",
    type,
    where: group.where ?? `this ${type}`,
    duration: DURATION_TEXT[effDuration],
  };

  const can = (m: Mode) => (m === "warn" || m === "ban") ? hasAuthor : m === "delete" ? group.canRemove : true;
  const pick = (m: Mode) => { if (!can(m)) return; setMode(m); setTemplateId(null); setDuration(null); };
  const pickTemplate = (t: Template) => { setMode(effMode); setTemplateId(t.id); setDuration(null); setMenu(false); };

  // 1–9 pick a template, Escape closes the menu, while nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && menu) { setMenu(false); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && inMode[n - 1]) pickTemplate(inMode[n - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // The menu closes on a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const reportIds = group.reports.map((r) => r.id);
  const reopen = () =>
    api.post("/moderation/reports/status", { reportIds, status: "pending" })
      .then(() => { qc.invalidateQueries({ queryKey: ["canvas-inspector"] }); qc.invalidateQueries({ queryKey: ["mod-summary"] }); })
      .catch((e) => toast.error(apiErrorMessage(e)));

  const act = useMutation({
    mutationFn: () => api.post("/moderation/reports/act", {
      reportIds, mode: effMode, templateId: template?.id ?? null,
      message: template ? fill(template.text, vars).trim() : FALLBACK[effMode], notify: true,
      ...(effMode === "ban" ? { duration: effDuration } : {}),
    }),
    onSuccess: () => {
      const closed = count > 1 ? `${count} reports resolved` : "report resolved";
      const who = author?.username ?? "the author";
      const msg = effMode === "warn" ? `Warning sent to ${who} · ${closed}`
        : effMode === "ban" ? `${who} banned (${DURATION_LABEL[effDuration]}) · ${closed}`
        : effMode === "delete" ? `Content removed · ${closed}`
        : `Report${count > 1 ? "s" : ""} dismissed`;
      // Only a dismissal is undone by reopening; a warning or ban has its own pardon/lift.
      toast.success(msg, effMode === "dismiss" ? { duration: UNDO_MS, action: { label: "Undo", onClick: () => void reopen() } } : undefined);
      qc.invalidateQueries({ queryKey: ["canvas-inspector"] });
      qc.invalidateQueries({ queryKey: ["mod-summary"] });
      qc.invalidateQueries({ queryKey: ["mod-templates"] });
      modStore.go(position + 1);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const submit: Record<Mode, { label: string; cls: string }> = {
    warn:    { label: "Send warning", cls: "mcp-send--warn" },
    ban:     { label: effDuration === "perm" ? "Ban permanently" : `Ban ${DURATION_LABEL[effDuration]}`, cls: "mcp-send--danger" },
    delete:  { label: "Remove", cls: "mcp-send--danger" },
    dismiss: { label: count > 1 ? "Dismiss reports" : "Dismiss", cls: "mcp-send--neutral" },
  };
  // Warn and ban carry the text to the member, so they need one; remove and dismiss
  // can go without.
  const needsText = effMode === "warn" || effMode === "ban";
  const disabled = !can(effMode) || act.isPending || (needsText && !template);

  return (
    <div className="mcp" role="region" aria-label="Report actions">
      <div className="mcp__id">
        <span className="mcp__ic mcp__ic--danger"><FontAwesomeIcon icon={faFlag} /></span>
        <div className="mcp__idtext">
          <span className="mcp__title">
            {topReason(group)}
            {count > 1 && <span className="mcp__count">×{count}</span>}
          </span>
          <span className="mcp__sub">{author ? `${author.username} · ${type}` : group.where ?? type}</span>
        </div>
      </div>

      <span className="mcp__rule" />

      <div className="mcp__seg" role="radiogroup" aria-label="Action">
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={effMode === m}
            className={effMode === m ? "is-on" : ""} disabled={!can(m)} onClick={() => pick(m)}>
            <FontAwesomeIcon icon={MODE_ICON[m]} /> {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="mcp__menuwrap" ref={menuRef}>
        {menu && (
          <div className="mcp-menu" role="listbox" aria-label="Premade texts">
            <div className="mcp-menu__head">{MODE_LABEL[effMode]} · premade texts</div>
            {effMode === "ban" && (
              <div className="mcp-menu__dur">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" className={effDuration === d ? "is-on" : ""} onClick={() => setDuration(d)}>
                    {DURATION_LABEL[d]}
                  </button>
                ))}
              </div>
            )}
            <div className="mcp-menu__list">
              {inMode.map((t, i) => (
                <button key={t.id} type="button" role="option" aria-selected={template?.id === t.id}
                  className={`mcp-menu__row${template?.id === t.id ? " is-on" : ""}`} onClick={() => pickTemplate(t)}>
                  {i < 9 && <kbd>{i + 1}</kbd>}
                  <span className="mcp-menu__body">
                    <span className="mcp-menu__name">
                      {t.name}
                      {suggestion?.id === t.id && <span className="mcp-menu__sug"><FontAwesomeIcon icon={faWandMagicSparkles} /> Suggested</span>}
                    </span>
                    <span className="mcp-menu__preview">{fill(t.text, vars)}</span>
                  </span>
                  {template?.id === t.id && <FontAwesomeIcon icon={faCheck} className="mcp-menu__check" />}
                </button>
              ))}
              {inMode.length === 0 && <p className="mcp-menu__empty">No texts for this action yet.</p>}
            </div>
            <div className="mcp-menu__foot">
              {isAdmin
                ? <Link to={`/admin/mod-templates${template ? `?id=${encodeURIComponent(template.id)}` : ""}`}>Admins write these in ACP → Moderation → Templates</Link>
                : "Admins write these in ACP → Moderation → Templates"}
            </div>
          </div>
        )}
        <button type="button" className="mcp__pick" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          {suggestion?.id === template?.id && template && <FontAwesomeIcon icon={faWandMagicSparkles} className="mcp__pick-sug" />}
          <span>{template?.name ?? "Premade text"}</span>
          <FontAwesomeIcon icon={faChevronUp} className="mcp__pick-chev" />
        </button>
      </div>

      <button type="button" className={`mcp-send ${submit[effMode].cls}`} disabled={disabled} onClick={() => act.mutate()}>
        <FontAwesomeIcon icon={MODE_ICON[effMode]} /> {act.isPending ? "Working…" : submit[effMode].label}
      </button>

      <span className="mcp__rule" />
      <span className="mcp__pos">{position + 1}/{total}</span>
      <button type="button" className="mcp__round" aria-label="Next report" disabled={position + 1 >= total}
        onClick={() => modStore.go(position + 1)}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
      <button type="button" className="mcp__round" aria-label="Close" onClick={modStore.close}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}
