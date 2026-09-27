import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faMagnifyingGlass, faArrowDownWideShort, faCheck, faChevronUp, faChevronDown, faHand, faLock,
  faTriangleExclamation, faBan, faTrash, faMinus, faPenToSquare, faWandMagicSparkles, faBook,
  faBolt, faCheckDouble, faXmark, faArrowLeft, faUser,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { toast } from "../../lib/toast";
import { apiErrorMessage } from "../../lib/swal";
import { useAuth } from "../../hooks/useAuth";
import { Username } from "../../components/Username";
import { UserAvatar } from "../../components/UserAvatar";
import {
  DURATIONS, DURATION_LABEL, DURATION_TEXT, MODES, MODE_LABEL, fill, suggest, typeLabel,
  type Duration, type Mode, type Template,
} from "./modTemplates";

// ── Wire types (GET /moderation/inspector) ────────────────────────────────────

interface Ref { id: string; username: string; badgeColor: string | null; avatar?: string | null }
interface LadderStep { warningCount: number; action: "notify" | "ban_temporary" | "ban_permanent"; banDays?: number }
export interface ReportGroup {
  key: string;
  targetType: string;
  targetId: string;
  where: string | null;
  href: string | null;
  snapshot: string | null;
  firstReportedAt: string;
  latestAt: string;
  reports: { id: string; reason: string; createdAt: string; reporter: Ref }[];
  author: (Ref & {
    joinedAt: string; activeWarnings: number; ladderSize: number;
    nextStep: LadderStep | null; otherOpenReports: number;
  }) | null;
  claimedBy: { id: string; username: string } | null;
}
interface Inspector { data: ReportGroup[]; total: number }

/** Long enough to reach for Undo; a plain success toast is gone in 3.5s. */
const UNDO_MS = 8000;

const MODE_ICON: Record<Mode, IconDefinition> = { warn: faTriangleExclamation, ban: faBan, delete: faTrash, dismiss: faMinus };

/** The reason most reporters gave — the row's and the detail's title. */
function topReason(g: ReportGroup): string {
  const tally = new Map<string, number>();
  for (const r of g.reports) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Report";
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
  || (t instanceof HTMLElement && t.isContentEditable);

export function ReportsInspector({ onManageTemplates, onOpenUser }: {
  /** Null when this moderator cannot open the ACP, where the texts are managed. */
  onManageTemplates: ((templateId: string | null) => void) | null;
  onOpenUser: (username: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Inspector>({
    queryKey: ["canvas-inspector"],
    queryFn: () => api.get("/moderation/inspector"),
  });
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["mod-templates"],
    queryFn: () => api.get("/moderation/templates"),
  });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mobileDetail, setMobileDetail] = useState(false);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = data?.data ?? [];
    if (!q) return all;
    return all.filter((g) => [topReason(g), g.where ?? "", g.author?.username ?? "", typeLabel(g.targetType), ...g.reports.map((r) => r.reason)]
      .join(" ").toLowerCase().includes(q));
  }, [data, filter]);

  const current = groups.find((g) => g.key === selected) ?? groups[0] ?? null;
  const index = current ? groups.indexOf(current) : -1;
  const go = (delta: number) => {
    const next = groups[index + delta];
    if (next) setSelected(next.key);
  };

  // J / K walk the list while nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") go(1);
      if (e.key === "k") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["canvas-inspector"] });
    qc.invalidateQueries({ queryKey: ["mod-summary"] });
  };

  /** After a group is handled, land on the one that followed it. */
  const advance = (handledKey: string) => {
    const i = groups.findIndex((g) => g.key === handledKey);
    const next = groups[i + 1] ?? groups[i - 1];
    setSelected(next && next.key !== handledKey ? next.key : null);
  };

  const reopen = (reportIds: string[]) =>
    api.post("/moderation/reports/status", { reportIds, status: "pending" }).then(refresh).catch((e) => toast.error(apiErrorMessage(e)));

  const bulk = useMutation({
    mutationFn: (status: "resolved" | "dismissed") => {
      const reportIds = (data?.data ?? []).filter((g) => checked.has(g.key)).flatMap((g) => g.reports.map((r) => r.id));
      return api.post<{ count: number }>("/moderation/reports/status", { reportIds, status }).then((res) => ({ res, reportIds, status }));
    },
    onSuccess: ({ res, reportIds, status }) => {
      setChecked(new Set());
      refresh();
      toast.success(`${res.count} report${res.count === 1 ? "" : "s"} ${status}`, {
        duration: UNDO_MS, action: { label: "Undo", onClick: () => void reopen(reportIds) },
      });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleCheck = (key: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className={`mc-split${mobileDetail ? " is-detail" : ""}`}>
      <aside className="mc-split__list">
        <div className="mc-split__top">
          <label className="mc-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter reports…" />
          </label>
          {checked.size === 0 ? (
            <div className="mc-split__meta">
              <span>Open · newest first</span>
              <FontAwesomeIcon icon={faArrowDownWideShort} />
            </div>
          ) : (
            <div className="mc-bulk">
              <b>{checked.size} selected</b>
              <button type="button" className="mc-btn mc-btn--ghost mc-btn--xs" disabled={bulk.isPending} onClick={() => bulk.mutate("dismissed")}>Dismiss</button>
              <button type="button" className="mc-btn mc-btn--primary mc-btn--xs" disabled={bulk.isPending} onClick={() => bulk.mutate("resolved")}>Resolve</button>
              <button type="button" className="mc-bulk__x" aria-label="Clear selection" onClick={() => setChecked(new Set())}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          )}
        </div>

        <div className="mc-split__rows">
          {isLoading ? (
            <div className="mc-empty">Loading…</div>
          ) : groups.map((g) => (
            <div key={g.key} role="button" tabIndex={0}
              className={`mc-rrow${current?.key === g.key ? " is-on" : ""}`}
              onClick={() => { setSelected(g.key); setMobileDetail(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") { setSelected(g.key); setMobileDetail(true); } }}>
              <button type="button" className={`mc-check${checked.has(g.key) ? " is-on" : ""}`} aria-label="Select"
                onClick={(e) => { e.stopPropagation(); toggleCheck(g.key); }}>
                {checked.has(g.key) && <FontAwesomeIcon icon={faCheck} />}
              </button>
              <div className="mc-rrow__body">
                <div className="mc-rrow__line">
                  <span className="mc-tag">{typeLabel(g.targetType)}</span>
                  {g.reports.length > 1 && <span className="mc-tag mc-tag--crit">×{g.reports.length}</span>}
                  {g.claimedBy && <FontAwesomeIcon icon={faHand} className="mc-rrow__claim" title={`Claimed by ${g.claimedBy.username}`} />}
                  <span className="mc-rrow__time">{timeAgo(g.latestAt)}</span>
                </div>
                <div className="mc-rrow__title">{topReason(g)}</div>
                <div className="mc-rrow__by">{g.author ? <>by {g.author.username}</> : g.where ?? typeLabel(g.targetType)}</div>
              </div>
            </div>
          ))}
          {!isLoading && groups.length === 0 && filter && <div className="mc-empty">Nothing matches “{filter}”.</div>}
        </div>
      </aside>

      <section className="mc-split__detail">
        {!isLoading && !current ? (
          <div className="mc-empty mc-empty--big">
            <FontAwesomeIcon icon={faCheckDouble} className="mc-empty__ic" />
            <span>No pending reports.</span>
          </div>
        ) : current ? (
          <Detail
            key={current.key}
            group={current}
            templates={templates}
            hasPrev={index > 0}
            hasNext={index < groups.length - 1}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onBack={() => setMobileDetail(false)}
            onManageTemplates={onManageTemplates}
            onOpenUser={onOpenUser}
            onFilterAuthor={(name) => setFilter(name)}
            onHandled={(key, message, reportIds, undoable) => {
              advance(key);
              refresh();
              qc.invalidateQueries({ queryKey: ["mod-templates"] });
              toast.success(message, undoable ? { duration: UNDO_MS, action: { label: "Undo", onClick: () => void reopen(reportIds) } } : undefined);
            }}
            onClaimed={refresh}
          />
        ) : null}
      </section>
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

function Detail({
  group, templates, hasPrev, hasNext, onPrev, onNext, onBack, onManageTemplates, onOpenUser, onFilterAuthor, onHandled, onClaimed,
}: {
  group: ReportGroup;
  templates: Template[];
  hasPrev: boolean; hasNext: boolean;
  onPrev: () => void; onNext: () => void; onBack: () => void;
  onManageTemplates: ((templateId: string | null) => void) | null;
  onOpenUser: (username: string) => void;
  onFilterAuthor: (username: string) => void;
  onHandled: (key: string, message: string, reportIds: string[], undoable: boolean) => void;
  onClaimed: () => void;
}) {
  const { user: me } = useAuth();
  const reportIds = group.reports.map((r) => r.id);
  const count = group.reports.length;
  const author = group.author;
  const mine = group.claimedBy?.id === me?.id;

  const claim = useMutation({
    mutationFn: () => api.post("/moderation/reports/claim", { reportIds, on: !mine }),
    onSuccess: onClaimed,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const segs = author ? Math.max(1, Math.min(author.ladderSize || 3, 6)) : 3;
  const active = author?.activeWarnings ?? 0;
  const nearBan = !!author?.nextStep && author.nextStep.action !== "notify";
  const hot = active >= 2 || nearBan;

  return (
    <div className="mc-detail">
      <button type="button" className="mc-detail__back" onClick={onBack}><FontAwesomeIcon icon={faArrowLeft} /> Reports</button>

      <div className="mc-detail__meta">
        <span className="mc-tag">{typeLabel(group.targetType)}</span>
        <span className={`mc-tag${count > 1 ? " mc-tag--crit" : ""}`}>{count} report{count === 1 ? "" : "s"}</span>
        <div className="mc-detail__nav">
          <button type="button" className={`mc-btn mc-btn--sm ${mine ? "mc-btn--claimed" : "mc-btn--ghost"}`}
            disabled={claim.isPending} onClick={() => claim.mutate()}
            title={group.claimedBy && !mine ? "Take this over" : undefined}>
            <FontAwesomeIcon icon={mine ? faCheck : faHand} />
            {mine ? "Claimed by you" : group.claimedBy ? `Claimed by ${group.claimedBy.username}` : "Claim"}
          </button>
          <button type="button" className="mc-sqbtn" disabled={!hasPrev} onClick={onPrev} aria-label="Previous (K)" title="Previous (K)">
            <FontAwesomeIcon icon={faChevronUp} />
          </button>
          <button type="button" className="mc-sqbtn" disabled={!hasNext} onClick={onNext} aria-label="Next (J)" title="Next (J)">
            <FontAwesomeIcon icon={faChevronDown} />
          </button>
        </div>
      </div>

      <div>
        <h2 className="mc-detail__title">{topReason(group)}</h2>
        <p className="mc-detail__sub">
          {group.href ? <a href={group.href} target="_blank" rel="noreferrer">{group.where ?? typeLabel(group.targetType)}</a> : (group.where ?? typeLabel(group.targetType))}
          {" · "}first reported {timeAgo(group.firstReportedAt)}
        </p>
      </div>

      <div className="mc-detail__grid">
        <div className="mc-card">
          <div className="mc-label"><FontAwesomeIcon icon={faLock} /> Snapshot at filing</div>
          {group.snapshot
            ? <blockquote className="mc-snapshot">{group.snapshot}</blockquote>
            : <p className="mc-snapshot mc-snapshot--none">No copy of the content was kept.</p>}
          <div className="mc-reporters">
            {group.reports.map((r) => (
              <div key={r.id} className="mc-reporters__row">
                <UserAvatar user={{ username: r.reporter.username, avatar: r.reporter.avatar ?? null }} size={24} />
                <span><b><Username username={r.reporter.username} badgeColor={r.reporter.badgeColor} /></b> · {r.reason}</span>
                <time>{timeAgo(r.createdAt)}</time>
              </div>
            ))}
          </div>
        </div>

        <div className="mc-card mc-author">
          {author ? (
            <>
              <div className="mc-author__head">
                <UserAvatar user={{ username: author.username, avatar: author.avatar ?? null }} size={36} />
                <div className="mc-author__id">
                  <b><Username username={author.username} badgeColor={author.badgeColor} /></b>
                  <span>Joined {new Date(author.joinedAt).toLocaleDateString()}</span>
                </div>
                <button type="button" className="mc-btn mc-btn--ghost mc-btn--xs" onClick={() => onOpenUser(author.username)}>
                  <FontAwesomeIcon icon={faUser} /> Profile
                </button>
              </div>
              <div className="mc-meter" aria-hidden>
                {Array.from({ length: segs }, (_, i) => (
                  <span key={i} className={i < active ? (hot ? "is-hot" : "is-on") : ""} />
                ))}
              </div>
              <p className={`mc-author__standing${hot && active > 0 ? " is-hot" : ""}`}>
                {active === 0 ? "No warnings on record" : `${active} of ${author.ladderSize || segs} active warnings`}
              </p>
              {author.otherOpenReports > 0 && (
                <button type="button" className="mc-link" onClick={() => onFilterAuthor(author.username)}>
                  {author.otherOpenReports} other open report{author.otherOpenReports === 1 ? "" : "s"} on this user
                </button>
              )}
            </>
          ) : (
            <p className="mc-author__none">This report names no author, so it can only be removed or dismissed.</p>
          )}
        </div>
      </div>

      <Composer group={group} templates={templates} onManageTemplates={onManageTemplates} onHandled={onHandled} />
    </div>
  );
}

// ── Action composer ───────────────────────────────────────────────────────────

function Composer({ group, templates, onManageTemplates, onHandled }: {
  group: ReportGroup;
  templates: Template[];
  onManageTemplates: ((templateId: string | null) => void) | null;
  onHandled: (key: string, message: string, reportIds: string[], undoable: boolean) => void;
}) {
  const author = group.author;
  const hasAuthor = !!author;
  const suggestion = useMemo(() => suggest(templates, group.reports.map((r) => r.reason), hasAuthor), [templates, group, hasAuthor]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const effMode: Mode = mode ?? suggestion?.mode ?? (hasAuthor ? "warn" : "dismiss");
  const inMode = templates.filter((t) => t.mode === effMode);
  const template = inMode.find((t) => t.id === templateId)
    ?? (suggestion?.mode === effMode ? suggestion : null)
    ?? inMode[0] ?? null;
  const effDuration: Duration = duration ?? template?.defaultDuration ?? "7d";

  const vars = {
    user: author?.username ?? "member",
    type: typeLabel(group.targetType),
    where: group.where ?? `this ${typeLabel(group.targetType)}`,
    duration: DURATION_TEXT[effDuration],
  };
  const filled = template ? fill(template.text, vars) : "";
  const text = message ?? filled;
  // A new template (or length) re-seeds the message; typing detaches it.
  useEffect(() => { setMessage(null); }, [template?.id, effDuration]);

  const pick = (m: Mode) => { setMode(m); setTemplateId(null); setDuration(null); };

  // 1–9 pick a template while nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && inMode[n - 1]) { setMode(effMode); setTemplateId(inMode[n - 1]!.id); setDuration(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reportIds = group.reports.map((r) => r.id);
  const count = reportIds.length;
  const act = useMutation({
    mutationFn: () => api.post("/moderation/reports/act", {
      reportIds, mode: effMode, templateId: template?.id ?? null, message: text.trim(), notify,
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
      onHandled(group.key, msg, reportIds, effMode === "dismiss");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const step = author?.nextStep;
  const ladderNote = effMode === "warn" && step && step.action !== "notify"
    ? `This is warning ${step.warningCount}, so issuing it also applies the ${step.action === "ban_permanent" ? "permanent" : `${step.banDays}-day`} ban from Mod Settings.`
    : null;

  const submit: Record<Mode, { label: string; cls: string; icon: IconDefinition }> = {
    warn: { label: "Send warning", cls: "mc-btn--warn", icon: faTriangleExclamation },
    ban: { label: effDuration === "perm" ? "Issue permanent ban" : `Issue ${DURATION_LABEL[effDuration]} ban`, cls: "mc-btn--danger", icon: faBan },
    delete: { label: "Remove content", cls: "mc-btn--danger", icon: faTrash },
    dismiss: { label: count > 1 ? "Dismiss reports" : "Dismiss report", cls: "mc-btn--neutral", icon: faMinus },
  };
  const disabled = (!hasAuthor && (effMode === "warn" || effMode === "ban"))
    || (effMode === "delete" && (group.targetType === "user" || !["article", "article_comment", "profile_comment"].includes(group.targetType)));

  return (
    <div className="mc-composer">
      <div className="mc-composer__head">
        <span className="mc-label">Take action</span>
        {onManageTemplates && (
          <button type="button" className="mc-textbtn" onClick={() => onManageTemplates(template?.id ?? null)}>
            <FontAwesomeIcon icon={faPenToSquare} /> Manage templates
          </button>
        )}
      </div>

      <div className="mc-seg mc-seg--4">
        {MODES.map((m) => (
          <button key={m} type="button" className={effMode === m ? "is-on" : ""} onClick={() => pick(m)}
            disabled={!hasAuthor && (m === "warn" || m === "ban")}>
            <FontAwesomeIcon icon={MODE_ICON[m]} /> {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div>
        <div className="mc-fieldlabel">Premade text</div>
        <div className="mc-chips">
          {inMode.map((t, i) => (
            <button key={t.id} type="button" className={`mc-tchip${template?.id === t.id ? " is-on" : ""}`}
              onClick={() => { setMode(effMode); setTemplateId(t.id); setDuration(null); }}>
              {i < 9 && <kbd>{i + 1}</kbd>}
              {t.name}
              {suggestion?.id === t.id && <span className="mc-tchip__sug"><FontAwesomeIcon icon={faWandMagicSparkles} /> Suggested</span>}
            </button>
          ))}
          {inMode.length === 0 && <span className="mc-muted">No texts for this action yet. An admin can add them in ACP → Moderation → Templates.</span>}
        </div>
      </div>

      <div className="mc-message">
        <textarea value={text} rows={4} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />
        <div className="mc-message__foot">
          {template?.ruleRef && <span className="mc-tag"><FontAwesomeIcon icon={faBook} /> {template.ruleRef}</span>}
          <span className="mc-muted">The name, place and length fill in automatically. The text stays editable.</span>
        </div>
      </div>

      {effMode === "ban" && (
        <div className="mc-durrow">
          <span className="mc-fieldlabel">Duration</span>
          <div className="mc-seg mc-seg--5">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={effDuration === d ? "is-on" : ""} onClick={() => setDuration(d)}>{DURATION_LABEL[d]}</button>
            ))}
          </div>
        </div>
      )}

      {ladderNote && (
        <div className="mc-ladder"><FontAwesomeIcon icon={faBolt} /> {ladderNote}</div>
      )}

      <div className="mc-composer__foot">
        <label className="mc-notify">
          <button type="button" className={`mc-check${notify ? " is-on" : ""}`} role="checkbox" aria-checked={notify} onClick={() => setNotify((v) => !v)}>
            {notify && <FontAwesomeIcon icon={faCheck} />}
          </button>
          <span onClick={() => setNotify((v) => !v)}>
            {effMode === "dismiss" ? "Tell reporters it was reviewed" : `Send to ${author?.username ?? "the author"} as a notification`}
          </span>
        </label>
        <span className="mc-muted">{count > 1 ? `Closes all ${count} reports` : "Closes this report"}</span>
        <button type="button" className={`mc-btn ${submit[effMode].cls}`} disabled={disabled || act.isPending || text.trim().length < 3}
          onClick={() => act.mutate()}>
          <FontAwesomeIcon icon={submit[effMode].icon} /> {act.isPending ? "Working…" : submit[effMode].label}
        </button>
      </div>
    </div>
  );
}
