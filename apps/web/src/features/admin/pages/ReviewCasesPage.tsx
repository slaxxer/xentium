import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pager } from "../../../components/Pager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faBan, faUserCheck, faRotateLeft, faShield, faShieldHalved, faNetworkWired, faFingerprint,
  faUserPlus, faKey, faUserSlash, faTriangleExclamation, faCheck, faMinus, faFilterCircleXmark,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/time";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { Avatar } from "../../../components/Avatar";
import { useAuth } from "../../../hooks/useAuth";
import "./ReviewCasesPage.scss";
import { siteTime } from "../../../lib/datetime";

// ACP → Moderation → Review Cases. Core surface for §15 review cases — the
// baseline patterns (core) and any plugin scans (e.g. a moderation plugin's)
// both open cases here via the shared /admin/cases endpoints.

type T = (key: string, opts?: Record<string, unknown>) => string;
type Status = "open" | "reviewed" | "all";
type Severity = "high" | "medium" | "low";
type Sort = "new" | "old";
const PAGE_SIZE = 7;

interface CaseAccount {
  id: string; username: string; avatar: string | null; badgeColor: string | null;
  registeredAt: string; lastLoginAt: string | null; lastIp: string | null;
  status: "active" | "banned" | "staff" | "inactive";
  willBeBanned: boolean;
}
interface SharedIdentifier { type: "ip" | "device"; value: string; accounts: number }
interface ModerationCase {
  id: string; type: string; severity: string; status: string;
  signals: string[]; notes: string | null; createdAt: string;
  linkedUserIds: string[]; linkedUsers: CaseAccount[];
  ipAddresses: string[]; sharedIdentifiers: SharedIdentifier[];
  assignedTo: { id: string; username: string; avatar: string | null } | null;
}
interface CasesResponse {
  data: ModerationCase[];
  meta: { total: number; totalPages: number };
  counts: { open: number; reviewed: number; all: number; total: number };
  detection: { enabled: boolean; lastRunAt: string | null; intervalMinutes: number | null } | null;
}
interface BanResult { userId: string; username: string; skipped: boolean; reason?: string }

const TYPES = [
  { value: "multi_account_suspicion", key: "typeMulti" },
  { value: "rapid_login_attempts",    key: "typeRapidLogin" },
  { value: "ban_evasion_suspicion",   key: "typeBanEvasion" },
  { value: "registration_burst",      key: "typeRegBurst" },
] as const;
const SEVERITIES: Severity[] = ["high", "medium", "low"];

function typeLabel(type: string, t: T): string {
  const key = TYPES.find((f) => f.value === type)?.key;
  return key ? t(`modCases.${key}`) : type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A detection signal as a row of evidence: what it is, and the sentence the scan
 * wrote. Signals are stored as prose, so the kind is recognised from its wording —
 * the same rules the old page used for its chips.
 */
function evidenceOf(s: string, t: T): { title: string; icon: IconDefinition; tone: "warn" | "danger" | "info" } {
  const l = s.toLowerCase();
  if (l.includes("device cookie") || l.includes("shared by")) return { title: t("modCases.sig.sharedDevice"), icon: faFingerprint, tone: "warn" };
  if (l.includes("failed login")) return { title: t("modCases.sig.rapidFailed"), icon: faKey, tone: "danger" };
  if ((l.includes("within") && l.includes("ban")) || l.includes("evasion")) return { title: t("modCases.sig.banEvasion"), icon: faUserSlash, tone: "danger" };
  if (l.includes("registration")) return { title: t("modCases.sig.regBurst"), icon: faUserPlus, tone: "warn" };
  if (l.includes("same ip") || l.includes(" ip")) return { title: t("modCases.sig.sameIp"), icon: faNetworkWired, tone: "info" };
  return { title: t("modCases.sig.other"), icon: faTriangleExclamation, tone: "warn" };
}

/** One sentence under the case title, from what the accounts actually share. */
function describe(c: ModerationCase, t: T): string {
  const names = c.linkedUsers.map((u) => u.username);
  const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names.join(" & ");
  if (c.sharedIdentifiers.some((s) => s.type === "device")) return t("modCases.desc.device", { names: list });
  if (c.sharedIdentifiers.some((s) => s.type === "ip")) return t("modCases.desc.ip", { names: list });
  return c.signals[0] ?? "";
}

function fmtDate(iso: string | null) {
  return iso ? siteTime.date(iso) : "—";
}

function Check({ state, onClick, label }: { state: "on" | "off" | "partial"; onClick: (e: React.MouseEvent) => void; label: string }) {
  return (
    <button type="button" className={`rc-check rc-check--${state}`} onClick={onClick} aria-label={label}
      aria-checked={state === "partial" ? "mixed" : state === "on"} role="checkbox">
      {state === "on" && <FontAwesomeIcon icon={faCheck} />}
      {state === "partial" && <i />}
    </button>
  );
}

function SevBadge({ severity, t }: { severity: string; t: T }) {
  return (
    <span className={`rc-sev rc-sev--${severity}`}>
      <FontAwesomeIcon icon={faShield} className="rc-sev__ic" />{t(`modCases.severity.${severity}`, { defaultValue: severity })}
    </span>
  );
}

/** Who a ban would touch, per account — the rule banCaseUsers applies, not a guess. */
function BanRows({ accounts, t }: { accounts: CaseAccount[]; t: T }) {
  return (
    <div className="rc-banrows">
      {accounts.map((a) => (
        <div key={a.id} className="rc-banrow">
          <Avatar user={{ username: a.username, avatar: a.avatar }} size={22} />
          <span className="rc-banrow__name">{a.username}</span>
          {a.willBeBanned
            ? <span className="rc-banrow__out rc-banrow__out--ban"><FontAwesomeIcon icon={faBan} />{t("modCases.preview.willBan")}</span>
            : <span className="rc-banrow__out"><FontAwesomeIcon icon={faMinus} />
                {a.status === "staff" ? t("modCases.preview.skipStaff") : t("modCases.preview.skipBanned")}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Mod note: saves itself ─────────────────────────────────────────────────────

function NoteField({ c }: { c: ModerationCase }) {
  const { t } = useTranslation("acp");
  const [value, setValue] = useState(c.notes ?? "");
  const [saved, setSaved] = useState(!!c.notes);
  const savedRef = useRef(c.notes ?? "");
  const timer = useRef<number>(0);
  const save = useMutation({
    mutationFn: (notes: string) => api.patch(`/admin/cases/${c.id}/notes`, { notes }),
    onSuccess: (_, notes) => { savedRef.current = notes; setSaved(!!notes); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // A different case resets the field; the same case refetched does not.
  useEffect(() => { setValue(c.notes ?? ""); savedRef.current = c.notes ?? ""; setSaved(!!c.notes); }, [c.id]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flush = (v: string) => { clearTimeout(timer.current); if (v !== savedRef.current) save.mutate(v); };

  return (
    <div className="rc-block">
      <div className="rc-label">
        {t("modCases.modNote")}
        {save.isPending ? <span className="rc-label__ok">{t("modCases.saving")}</span>
          : saved && value === savedRef.current && <span className="rc-label__ok"><FontAwesomeIcon icon={faCheck} />{t("modCases.saved")}</span>}
      </div>
      <textarea className="rc-note" rows={2} value={value} maxLength={2000}
        placeholder={t("modCases.notePlaceholder")}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => flush(v), 900);
        }}
        onBlur={() => flush(value)} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReviewCasesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { user: me } = useAuth();

  // Mod Settings links here per pattern ("See them"): ?type=…&status=all opens the list pre-filtered.
  const [urlParams] = useSearchParams();
  const [status, setStatus] = useState<Status>(() => {
    const s = urlParams.get("status");
    return s === "open" || s === "reviewed" || s === "all" ? s : "open";
  });
  const [type, setType] = useState(() => urlParams.get("type") ?? "");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [sort, setSort] = useState<Sort>("new");
  // Seven cases a page, in the chosen order: a case wants reading, not scrolling past.
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [banPreview, setBanPreview] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(false);
  const [reason, setReason] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page), status, sort });
  if (type) params.set("type", type);
  if (severity) params.set("severity", severity);

  const { data, isLoading } = useQuery<CasesResponse>({
    queryKey: ["acp-cases", status, type, severity, sort, page],
    queryFn: () => api.get(`/admin/cases?${params}`),
    placeholderData: (prev) => prev,
  });

  const cases = data?.data ?? [];
  // If the selected case is filtered out, the detail shows the first visible one.
  const selected = cases.find((c) => c.id === selectedId) ?? cases[0] ?? null;
  const narrowed = status !== "open" || !!type || !!severity;

  // Any filter change clears the selection and closes a preview.
  const refilter = <V,>(set: (v: V) => void) => (v: V) => {
    set(v); setPage(1); setChecked(new Set()); setBanPreview(false); setBulkPreview(false);
  };
  // A page past the end (the last case on it was handled) steps back to the last one.
  const totalPages = data?.meta.totalPages ?? 1;
  useEffect(() => { if (page > 1 && page > totalPages) setPage(Math.max(1, totalPages)); }, [page, totalPages]);
  const clearFilters = () => { setType(""); setSeverity(""); refilter(setStatus)("open"); };
  useEffect(() => { setBanPreview(false); setAssignOpen(false); setReason(""); }, [selected?.id]);
  useEffect(() => { if (checked.size === 0) setBulkPreview(false); }, [checked.size]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["acp-cases"] });
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));
  const defaultReason = t("modCases.preview.defaultReason");

  const allowMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.patch(`/admin/cases/${id}`, { status: "reviewed" }))),
    onSuccess: (_, ids) => { refresh(); setChecked(new Set()); toast.success(t("modCases.toastAllowed", { count: ids.length })); },
    onError: fail,
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/cases/${id}/revoke-exception`, {}),
    onSuccess: () => { refresh(); toast.success(t("modCases.toastExceptionRevoked")); },
    onError: fail,
  });
  const banMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const out: BanResult[] = [];
      for (const id of ids) out.push(...await api.post<BanResult[]>(`/admin/cases/${id}/ban-all`, { reason: reason.trim() || defaultReason }));
      return out;
    },
    onSuccess: (results) => {
      refresh(); setChecked(new Set()); setBanPreview(false); setBulkPreview(false); setReason("");
      const banned = new Set(results.filter((r) => !r.skipped).map((r) => r.userId)).size;
      const skipped = new Set(results.filter((r) => r.skipped).map((r) => r.userId)).size;
      toast.success(skipped ? t("modCases.toastBannedSkipped", { banned, skipped }) : t("modCases.toastBanned", { banned }));
    },
    onError: fail,
  });
  const assignMut = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) => api.patch(`/admin/cases/${id}/assign`, { userId }),
    onSuccess: () => { refresh(); setAssignOpen(false); },
    onError: fail,
  });
  const busy = allowMut.isPending || revokeMut.isPending || banMut.isPending;

  const allow = async (ids: string[]) => {
    const ok = await openDialog({
      kind: "confirm", icon: "question", title: t("modCases.grantTitle"), body: t("modCases.grantBody"),
      confirmText: t("modCases.grantBtn"), cancelText: t("common:actions.cancel"),
    });
    if (ok) allowMut.mutate(ids);
  };
  const revoke = async (id: string) => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", title: t("modCases.revokeTitle"), body: t("modCases.revokeBody"),
      confirmText: t("modCases.revokeBtn"), cancelText: t("common:actions.cancel"),
    });
    if (ok) revokeMut.mutate(id);
  };

  const checkedCases = cases.filter((c) => checked.has(c.id));
  // One row per account across the selection, however many cases link it.
  const bulkAccounts = useMemo(() => {
    const m = new Map<string, CaseAccount>();
    for (const c of checkedCases) for (const a of c.linkedUsers) m.set(a.id, a);
    return [...m.values()];
  }, [checkedCases]);
  const allState: "on" | "off" | "partial" =
    cases.length > 0 && cases.every((c) => checked.has(c.id)) ? "on" : checked.size > 0 ? "partial" : "off";

  const det = data?.detection;
  const detLine = det?.lastRunAt
    ? t("modCases.detection.ran", { when: timeAgo(det.lastRunAt), every: det.intervalMinutes ?? "?" })
    : det && !det.enabled ? t("modCases.detection.off") : t("modCases.detection.never");

  return (
    <div className="rc">
      <div className="pg-head rc-head">
        <div>
          <p className="pg-eyebrow">{t("modCases.sub")}</p>
          <h1 className="pg-title">{t("modCases.title")}</h1>
        </div>
        {det && (
          <span className={`rc-detect${det.enabled ? "" : " is-off"}`}><i />{detLine}</span>
        )}
      </div>

      {/* Filters */}
      <div className="rc-filters">
        <div className="rc-filters__row">
          <div className="rc-seg">
            {(["open", "reviewed", "all"] as Status[]).map((s) => (
              <button key={s} type="button" className={status === s ? "is-on" : ""} onClick={() => refilter(setStatus)(s)}>
                {t(`modCases.status.${s}`)}<span className="rc-seg__n">{data?.counts[s] ?? "–"}</span>
              </button>
            ))}
          </div>
          <span className="rc-gap" />
          <span className="rc-flabel">{t("modCases.sort")}</span>
          {(["new", "old"] as Sort[]).map((s) => (
            <button key={s} type="button" className={`rc-chip rc-chip--sm${sort === s ? " is-on" : ""}`} onClick={() => { setSort(s); setPage(1); }}>
              {t(`modCases.sortBy.${s}`)}
            </button>
          ))}
        </div>
        <div className="rc-filters__row rc-filters__row--split">
          <span className="rc-flabel">{t("modCases.pattern")}</span>
          {TYPES.map((tf) => (
            <button key={tf.value} type="button" className={`rc-chip${type === tf.value ? " is-on" : ""}`}
              onClick={() => refilter(setType)(type === tf.value ? "" : tf.value)}>
              {t(`modCases.${tf.key}`)}
            </button>
          ))}
          <span className="rc-vdiv" />
          <span className="rc-flabel">{t("modCases.severityLabel")}</span>
          {SEVERITIES.map((s) => (
            <button key={s} type="button" className={`rc-chip${severity === s ? " is-on" : ""}`}
              onClick={() => refilter(setSeverity)(severity === s ? "" : s)}>
              <i className={`rc-dot rc-dot--${s}`} />{t(`modCases.severity.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="rc-empty"><p>{t("modCases.loading")}</p></div>
      ) : cases.length === 0 ? (
        narrowed ? (
          <div className="rc-empty">
            <div className="rc-empty__ic"><FontAwesomeIcon icon={faFilterCircleXmark} /></div>
            <h3>{t("modCases.emptyFiltered.title")}</h3>
            <p>{t("modCases.emptyFiltered.body", { count: data?.counts.total ?? 0 })}</p>
            <button type="button" className="rc-btn rc-btn--soft" onClick={clearFilters}>{t("modCases.clearFilters")}</button>
          </div>
        ) : (
          <div className="rc-empty">
            <div className="rc-empty__ic rc-empty__ic--ok"><FontAwesomeIcon icon={faShieldHalved} /></div>
            <h3>{t("modCases.emptyClear.title")}</h3>
            <p>{det?.lastRunAt
              ? t("modCases.emptyClear.body", { when: timeAgo(det.lastRunAt), every: det.intervalMinutes ?? 30 })
              : t("modCases.emptyClear.bodyNever")}</p>
            <div className="rc-empty__links">
              <Link to="/admin/modsettings">{t("modCases.emptyClear.thresholds")}</Link>
              <Link to="/admin/modlog">{t("modCases.emptyClear.modLog")}</Link>
            </div>
          </div>
        )
      ) : (
        <div className="rc-body">
          {/* ── List ── */}
          <section className="rc-list">
            <div className="rc-list__head">
              <Check state={allState} label={t("modCases.selectAll")}
                onClick={() => setChecked(allState === "on" ? new Set() : new Set(cases.map((c) => c.id)))} />
              <b>{t("modCases.caseCount", { count: data?.meta.total ?? cases.length })}</b>
              <span className="rc-gap" />
              <span className="rc-list__sort">{t(`modCases.sortedBy.${sort}`)}</span>
            </div>
            {cases.map((c) => {
              const on = checked.has(c.id);
              return (
                <div key={c.id} className={`rc-row${selected?.id === c.id ? " is-selected" : ""}`}>
                  <Check state={on ? "on" : "off"} label={t("modCases.select")}
                    onClick={(e) => { e.stopPropagation(); setChecked((prev) => {
                      const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n;
                    }); }} />
                  <button type="button" className="rc-row__main" onClick={() => setSelectedId(c.id)}>
                    <span className="rc-row__l1">
                      <i className={`rc-dot rc-dot--${c.severity}`} />
                      <b>{typeLabel(c.type, t)}</b>
                      {c.status === "reviewed" && <span className="rc-exc">{t("modCases.exception")}</span>}
                    </span>
                    <span className="rc-row__l2">
                      <span className="rc-stack">
                        {c.linkedUsers.slice(0, 3).map((u) => <Avatar key={u.id} user={{ username: u.username, avatar: u.avatar }} size={20} />)}
                      </span>
                      <span className="rc-row__names">{c.linkedUsers.map((u) => u.username).join(", ") || "—"}</span>
                    </span>
                    <span className="rc-row__l3">
                      {t("modCases.signalsN", { count: c.signals.length })}{c.ipAddresses[0] ? ` · ${c.ipAddresses[0]}` : ""}
                    </span>
                  </button>
                  <span className="rc-row__age">{timeAgo(c.createdAt)}</span>
                </div>
              );
            })}
            {totalPages > 1 && (
              <Pager page={page} totalPages={totalPages} onPage={(n) => { setPage(n); setChecked(new Set()); }}
                label={t("modCases.pagination", { page, totalPages, total: data?.meta.total ?? 0 })} />
            )}

            {checked.size > 0 && (
              <div className="rc-bulk">
                <b>{t("modCases.bulk.selected", { count: checked.size })}</b>
                <span className="rc-gap" />
                <button type="button" className="rc-btn rc-btn--ghost rc-btn--xs" onClick={() => setChecked(new Set())}>{t("modCases.bulk.clear")}</button>
                <button type="button" className="rc-btn rc-btn--ok rc-btn--xs" disabled={busy}
                  onClick={() => void allow(checkedCases.filter((c) => c.status === "open").map((c) => c.id))}>
                  {t("modCases.allowShort")}
                </button>
                <button type="button" className="rc-btn rc-btn--danger rc-btn--xs" disabled={busy}
                  onClick={() => { setBanPreview(false); setBulkPreview(true); }}>
                  {t("modCases.banAll")}
                </button>
              </div>
            )}
            {bulkPreview && checked.size > 0 && (
              <div className="rc-preview rc-preview--bulk">
                <b className="rc-preview__title">
                  {t("modCases.preview.bulkTitle", { cases: checked.size, accounts: bulkAccounts.length })}
                </b>
                <span className="rc-preview__sub">{checkedCases.map((c) => typeLabel(c.type, t)).join(" · ")}</span>
                <BanRows accounts={bulkAccounts} t={t} />
                <label className="rc-label">{t("modCases.preview.reason")}</label>
                <input className="rc-input" value={reason} maxLength={500} placeholder={defaultReason} onChange={(e) => setReason(e.target.value)} />
                <div className="rc-preview__actions">
                  <button type="button" className="rc-btn rc-btn--ghost" onClick={() => setBulkPreview(false)}>{t("common:actions.cancel")}</button>
                  <button type="button" className="rc-btn rc-btn--solid-danger"
                    disabled={busy || bulkAccounts.every((a) => !a.willBeBanned)}
                    onClick={() => banMut.mutate(checkedCases.map((c) => c.id))}>
                    {t("modCases.preview.banN", { count: bulkAccounts.filter((a) => a.willBeBanned).length })}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Detail ── */}
          {selected && (
            <section className="rc-detail">
              <header className="rc-detail__head">
                <div className="rc-detail__titles">
                  <div className="rc-detail__line">
                    <h2>{typeLabel(selected.type, t)}</h2>
                    <SevBadge severity={selected.severity} t={t} />
                    <span className={`rc-state rc-state--${selected.status}`}>{t(`modCases.caseStatus.${selected.status}`, { defaultValue: selected.status })}</span>
                  </div>
                  <p>{describe(selected, t)}</p>
                </div>
                <div className="rc-detail__meta">
                  <span>{t("modCases.opened", { when: timeAgo(selected.createdAt) })}</span>
                  <div className="rc-assign">
                    <button type="button" className="rc-assign__btn" onClick={() => setAssignOpen((o) => !o)} aria-expanded={assignOpen}>
                      {selected.assignedTo
                        ? <Avatar user={{ username: selected.assignedTo.username, avatar: selected.assignedTo.avatar }} size={22} />
                        : <span className="rc-assign__none">?</span>}
                      <span>{selected.assignedTo?.username ?? t("modCases.unassigned")}</span>
                      <FontAwesomeIcon icon={faChevronDown} className="rc-assign__chev" />
                    </button>
                    {assignOpen && (
                      <div className="rc-assign__menu">
                        {selected.assignedTo?.id !== me?.id && (
                          <button type="button" onClick={() => assignMut.mutate({ id: selected.id, userId: me!.id })}>{t("modCases.assignMe")}</button>
                        )}
                        {selected.assignedTo && (
                          <button type="button" onClick={() => assignMut.mutate({ id: selected.id, userId: null })}>{t("modCases.unassign")}</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </header>

              <div className="rc-block">
                <div className="rc-label">{t("modCases.evidence")}</div>
                <div className="rc-evidence">
                  {selected.signals.map((s, i) => {
                    const ev = evidenceOf(s, t);
                    return (
                      <div key={i} className="rc-ev">
                        <span className={`rc-ev__ic rc-ev__ic--${ev.tone}`}><FontAwesomeIcon icon={ev.icon} /></span>
                        <span className="rc-ev__text"><b>{ev.title}</b><span>{s}</span></span>
                      </div>
                    );
                  })}
                  {selected.signals.length === 0 && <p className="rc-muted">{t("modCases.noEvidence")}</p>}
                </div>
              </div>

              <div className="rc-block">
                <div className="rc-label">{t("modCases.linked")}<span className="rc-count">{t("modCases.accountsN", { count: selected.linkedUsers.length })}</span></div>
                <div className="rc-table">
                  <div className="rc-tr rc-tr--head">
                    <span>{t("modCases.col.account")}</span><span>{t("modCases.col.registered")}</span>
                    <span>{t("modCases.col.lastLogin")}</span><span>{t("modCases.col.lastIp")}</span><span>{t("modCases.col.status")}</span>
                  </div>
                  {selected.linkedUsers.map((a) => {
                    const sharedIp = !!a.lastIp && selected.sharedIdentifiers.some((s) => s.type === "ip" && s.value === a.lastIp);
                    return (
                      <div key={a.id} className="rc-tr">
                        <span className="rc-acc">
                          <Avatar user={{ username: a.username, avatar: a.avatar }} size={24} />
                          <Link to={`/admin/users/${a.id}`}>{a.username}</Link>
                        </span>
                        <span className="rc-td-muted" data-label={t("modCases.col.registered")}>{fmtDate(a.registeredAt)}</span>
                        <span className="rc-td-muted" data-label={t("modCases.col.lastLogin")}>{a.lastLoginAt ? timeAgo(a.lastLoginAt) : "—"}</span>
                        <span data-label={t("modCases.col.lastIp")}>{a.lastIp ? <code className={`rc-mono${sharedIp ? " is-shared" : ""}`}>{a.lastIp}</code> : "—"}</span>
                        <span><span className={`rc-acct rc-acct--${a.status}`}>{t(`modCases.acct.${a.status}`)}</span></span>
                      </div>
                    );
                  })}
                  {selected.sharedIdentifiers.length > 0 && (
                    <div className="rc-shared">
                      <span className="rc-flabel">{t("modCases.shared")}</span>
                      {selected.sharedIdentifiers.map((s) => (
                        <code key={`${s.type}:${s.value}`} className="rc-mono is-shared" title={t("modCases.sharedBy", { count: s.accounts })}>
                          <FontAwesomeIcon icon={s.type === "device" ? faFingerprint : faNetworkWired} />
                          {s.type === "device" ? s.value.slice(0, 13) : s.value}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <NoteField c={selected} />

              {banPreview && (
                <div className="rc-preview">
                  <b className="rc-preview__title">
                    {t("modCases.preview.title", { count: selected.linkedUsers.filter((a) => a.willBeBanned).length })}
                  </b>
                  <BanRows accounts={selected.linkedUsers} t={t} />
                  <label className="rc-label">{t("modCases.preview.reason")}</label>
                  <input className="rc-input" value={reason} maxLength={500} placeholder={defaultReason} onChange={(e) => setReason(e.target.value)} />
                  <div className="rc-preview__actions">
                    <button type="button" className="rc-btn rc-btn--ghost" onClick={() => setBanPreview(false)}>{t("common:actions.cancel")}</button>
                    <button type="button" className="rc-btn rc-btn--solid-danger"
                      disabled={busy || selected.linkedUsers.every((a) => !a.willBeBanned)}
                      onClick={() => banMut.mutate([selected.id])}>
                      {t("modCases.preview.banN", { count: selected.linkedUsers.filter((a) => a.willBeBanned).length })}
                    </button>
                  </div>
                </div>
              )}

              <footer className="rc-detail__foot">
                <code className="rc-prov">{t("modCases.provenance", { type: selected.type })}</code>
                <span className="rc-gap" />
                {selected.status === "open" && (
                  <>
                    <button type="button" className="rc-btn rc-btn--ok" disabled={busy} onClick={() => void allow([selected.id])}>
                      <FontAwesomeIcon icon={faUserCheck} />{t("modCases.allowLong")}
                    </button>
                    <button type="button" className="rc-btn rc-btn--danger" disabled={busy}
                      onClick={() => { setBulkPreview(false); setBanPreview(true); }}>
                      <FontAwesomeIcon icon={faBan} />{t("modCases.banAll")}
                    </button>
                  </>
                )}
                {selected.status === "reviewed" && (
                  <button type="button" className="rc-btn rc-btn--warn" disabled={busy} onClick={() => void revoke(selected.id)}>
                    <FontAwesomeIcon icon={faRotateLeft} />{t("modCases.revokeLong")}
                  </button>
                )}
              </footer>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
