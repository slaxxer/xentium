import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faArrowRight, faChevronDown, faChevronUp, faCircleCheck, faCircleNotch, faCloudArrowDown,
  faRotate, faShieldHalved, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { runStreamedJob } from "../../../lib/streamProgress";
import { siteTime } from "../../../lib/datetime";
import "./UpdatesPage.scss";
import { Button } from "../../../components/AcpControls";

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired?:  boolean;
  /** Older caches carried one text; the marketplace now sends notes per release. */
  changelog?:        string;
  /** "What's new": every release between installed and latest that has notes, newest first. */
  notes?:            { version: string; changes: Change[]; publishedAt: string | null }[];
}

type ChangeType = "new" | "improved" | "fixed" | "security" | "breaking" | "other";
interface Change { type: ChangeType; text: string }
/** What an admin must know first, first. */
const CHANGE_ORDER: ChangeType[] = ["breaking", "security", "new", "improved", "fixed", "other"];

/** A published security advisory against a version this site runs. */
interface Advisory {
  id: string; pluginId: string; name: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  affects: string; fixedIn: string | null; summary: string | null;
}

interface UpdatesResponse {
  checkedAt: string | null;
  updates: PluginUpdate[];
  advisories?: Advisory[];
  /** Only on a "Check now" answer. */
  check?: "checked" | "failed" | "busy" | "no-account";
}

interface InstalledLite { id: string; vendor: string }

/** One running update, shown in its row rather than in a dialog. */
interface Running { percent: number; label: string }

const QK = ["acp-marketplace-updates"] as const;
const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/** "patch" | "minor" | "major" from two semver strings, or null when either is not one. */
function bumpKind(from: string | null | undefined, to: string): "major" | "minor" | "patch" | null {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const a = from ? parse(from) : undefined;
  const b = parse(to);
  if (!a || !b) return null;
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  return "patch";
}

/** One release's "what's new", as the row shows it. */
interface NoteGroup { version: string | null; date: string | null; changes: Change[] }

/**
 * The update's notes per release; the version heading only matters when there are
 * several. An older cache carried one text instead, shown as untyped lines.
 */
function noteGroups(u: PluginUpdate): NoteGroup[] {
  if (u.notes?.length) {
    return u.notes
      .map((n) => ({ version: n.version, date: n.publishedAt, changes: n.changes ?? [] }))
      .filter((g) => g.changes.length > 0);
  }
  const lines = noteLines(u.changelog);
  return lines.length ? [{ version: null, date: null, changes: lines.map((text) => ({ type: "other" as const, text })) }] : [];
}

/** Every breaking change an update would bring, across the releases it skips. */
function breakingChanges(u: PluginUpdate): string[] {
  return (u.notes ?? []).flatMap((n) => (n.changes ?? []).filter((c) => c.type === "breaking").map((c) => c.text));
}

/** A changelog arrives as text; one line per change reads as a list. */
function noteLines(changelog: string | undefined): string[] {
  return (changelog ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export function UpdatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<UpdatesResponse>({
    queryKey:  QK,
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });
  const { data: installed = [] } = useQuery<InstalledLite[]>({
    queryKey: ["acp-installed-plugins"],
    queryFn:  () => api.get("/plugins"),
  });
  const vendorOf = useMemo(() => new Map(installed.map((p) => [p.id, p.vendor])), [installed]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Record<string, Running>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  // Updated rows stay on the page (marked "Updated") until the admin leaves, even
  // though the refreshed list no longer contains them.
  const [done, setDone] = useState<Record<string, PluginUpdate>>({});

  const check = useMutation({
    mutationFn: () => api.post<UpdatesResponse>("/admin/marketplace/updates/check", {}),
    onSuccess: (res) => {
      qc.setQueryData(QK, res);
      if (res.check === "failed") toast.error(t("updates.checkFailed"));
      else if (res.check === "no-account") toast.info(t("updates.checkNoAccount"));
      else if (res.check === "busy") toast.info(t("updates.checkBusy"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // ── The update queue: one at a time, in the order asked ─────────────────────
  const updatesRef = useRef<PluginUpdate[]>([]);
  updatesRef.current = data?.updates ?? [];
  const working = useRef(false);

  const runOne = useCallback(async (u: PluginUpdate) => {
    const name = u.name ?? u.pluginId;
    setRunning((r) => ({ ...r, [u.pluginId]: { percent: 0, label: t("updates.phase.starting") } }));
    let message: string | null = null;
    const { ok, final } = await runStreamedJob(
      "/admin/marketplace/update",
      { pluginId: u.pluginId, version: u.latestVersion },
      {
        silent: true,
        title: t("updates.progressTitle", { name }),
        phaseLabel: () => "",
        successMessage: () => "",
        failureMessage: (fin, err) => {
          message = (fin?.message as string) ?? (err instanceof Error ? err.message : t("updates.progressFailed"));
          return message;
        },
        onProgress: (evt) => {
          const label = t(`updates.phase.${evt.phase}`, { defaultValue: t("updates.phase.working") });
          setRunning((r) => ({
            ...r,
            [u.pluginId]: { percent: Math.max(r[u.pluginId]?.percent ?? 0, evt.percent ?? 0), label: evt.message ? `${label} ${evt.message}` : label },
          }));
        },
      },
    );
    setRunning((r) => { const n = { ...r }; delete n[u.pluginId]; return n; });
    if (ok) {
      setDone((d) => ({ ...d, [u.pluginId]: { ...u, latestVersion: (final?.version as string) ?? u.latestVersion } }));
      setSelected((s) => { const n = new Set(s); n.delete(u.pluginId); return n; });
      toast.success(t("updates.progressDone", { name, version: (final?.version as string) ?? u.latestVersion }));
    } else {
      const msg = message ?? t("updates.progressFailed");
      setFailed((f) => ({ ...f, [u.pluginId]: msg }));
      toast.error(t("updates.failedToast", { name }));
    }
  }, [t]);

  useEffect(() => {
    if (working.current || queue.length === 0) return;
    const [next, ...rest] = queue;
    const u = updatesRef.current.find((x) => x.pluginId === next);
    if (!u) { setQueue(rest); return; }
    working.current = true;
    void runOne(u).finally(() => {
      working.current = false;
      setQueue((q) => {
        const left = q.filter((id) => id !== next);
        // The list, the installed versions and the ACP badge refresh once the
        // queue is empty, so rows do not jump about while others are still running.
        if (left.length === 0) {
          void qc.invalidateQueries({ queryKey: QK });
          void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
          void qc.invalidateQueries({ queryKey: ["acp-status-summary"] });
        }
        return left;
      });
    });
  }, [queue, runOne, qc]);

  const start = async (ids: string[]) => {
    const ok = ids.filter((id) => {
      const u = updatesRef.current.find((x) => x.pluginId === id);
      return u && !u.renewalRequired && !done[id] && !running[id] && !queue.includes(id);
    });
    if (!ok.length) return;
    // A release that says it breaks something is not updated on one click: the
    // admin reads what breaks first, for every plugin in this batch.
    const breaking = ok
      .map((id) => updatesRef.current.find((x) => x.pluginId === id)!)
      .map((u) => ({ name: u.name ?? u.pluginId, items: breakingChanges(u) }))
      .filter((b) => b.items.length > 0);
    if (breaking.length) {
      const go = await openDialog({
        kind: "confirm",
        icon: "warning",
        title: t("updates.breakingTitle", { count: breaking.length }),
        bodyNode: (
          <div className="upd-breaking">
            <p>{t("updates.breakingText")}</p>
            {breaking.map((b) => (
              <div key={b.name}>
                <strong>{b.name}</strong>
                <ul>{b.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        ),
        confirmText: t("updates.breakingConfirm"),
        cancelText: t("updates.cancel"),
      });
      if (!go) return;
    }
    setFailed((f) => { const n = { ...f }; ok.forEach((id) => delete n[id]); return n; });
    setQueue((q) => [...q, ...ok]);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const updates = data?.updates ?? [];
  const advisories = data?.advisories ?? [];
  const rows = useMemo(() => {
    const live = updates.filter((u) => !done[u.pluginId]);
    const all = [...live, ...Object.values(done)];
    return all.sort((a, b) => Number(b.critical) - Number(a.critical));
  }, [updates, done]);

  const isBusy = (id: string) => !!running[id] || queue.includes(id);
  const eligible = rows.filter((u) => !u.renewalRequired && !done[u.pluginId] && !isBusy(u.pluginId));
  const selectedIds = eligible.filter((u) => selected.has(u.pluginId)).map((u) => u.pluginId);
  const allSelected = eligible.length > 0 && selectedIds.length === eligible.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const pending = rows.filter((u) => !done[u.pluginId]);
  const critical = pending.filter((u) => u.critical).length;

  const checkedLabel = data?.checkedAt ? siteTime.stamp(data.checkedAt) : t("updates.neverChecked");

  const checkButton = (
    <Button variant="ghost" className="upd-check" onClick={() => check.mutate()} disabled={check.isPending}>
      <FontAwesomeIcon icon={faRotate} spin={check.isPending} />
      {check.isPending ? t("updates.checking") : t("updates.checkNow")}
    </Button>
  );

  return (
    <div className="upd">
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("updates.title")}</h1>
        </div>
        {rows.length > 0 && (
          <div className="upd-head-actions">
            <span className="upd-checked">{t("updates.lastChecked", { date: checkedLabel })}</span>
            {checkButton}
          </div>
        )}
      </div>

      {advisories.length > 0 && (
        <Advisories
          items={advisories}
          updateFor={(id) => updates.find((u) => u.pluginId === id)}
          isBusy={isBusy}
          isDone={(id) => !!done[id]}
          onFix={(id) => void start([id])}
        />
      )}

      {isLoading ? (
        <div className="acp-card acp-empty">{t("updates.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="acp-card upd-uptodate">
          <span className="upd-uptodate__ic"><FontAwesomeIcon icon={faCircleCheck} /></span>
          <div className="upd-uptodate__text">
            <div className="upd-uptodate__title">{t("updates.emptyTitle")}</div>
            <div className="upd-uptodate__hint">
              {advisories.length ? t("updates.emptyNoUpdates") : t("updates.emptyNothing")}{" "}
              {t("updates.lastChecked", { date: checkedLabel })}.
            </div>
          </div>
          {checkButton}
        </div>
      ) : (
        <section className="acp-card upd-list" aria-label={t("updates.title")}>
          <div className="upd-list__head">
            <input
              type="checkbox"
              className="upd-check-box"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              disabled={eligible.length === 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(eligible.map((u) => u.pluginId)))}
              aria-label={t("updates.selectAll")}
            />
            <div className="upd-list__count">
              <strong>{pending.length ? t("updates.available", { count: pending.length }) : t("updates.allInstalled")}</strong>
              {critical > 0 && <span className="upd-list__crit">{t("updates.criticalCount", { count: critical })}</span>}
            </div>
            <Button
             
              disabled={selectedIds.length === 0}
              onClick={() => void start(selectedIds)}
            >
              <FontAwesomeIcon icon={faCloudArrowDown} />
              {selectedIds.length ? t("updates.updateSelectedN", { count: selectedIds.length }) : t("updates.updateSelected")}
            </Button>
          </div>

          {rows.map((u) => {
            const id = u.pluginId;
            const run = running[id];
            const queued = !run && queue.includes(id);
            const isDone = !!done[id];
            const renewal = !!u.renewalRequired && !isDone;
            const selectable = !renewal && !isDone && !run && !queued;
            const notes = noteGroups(u);
            const open = openNotes.has(id) && !run;
            const released = u.notes?.find((n) => n.version === u.latestVersion)?.publishedAt ?? null;
            const breaks = !isDone && breakingChanges(u).length > 0;
            const kind = bumpKind(u.installedVersion, u.latestVersion);
            const name = u.name ?? id;
            const vendor = vendorOf.get(id);
            return (
              <div key={id} className={`upd-row${u.critical && !isDone ? " is-critical" : ""}`}>
                <div className="upd-row__check">
                  <input
                    type="checkbox"
                    className="upd-check-box"
                    checked={selectable && selected.has(id)}
                    disabled={!selectable}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                    aria-label={t("updates.select", { name })}
                  />
                </div>
                <span className={`upd-row__ic${u.critical && !isDone ? " is-critical" : ""}`} aria-hidden="true">
                  {u.critical && !isDone ? <FontAwesomeIcon icon={faTriangleExclamation} /> : name.charAt(0).toUpperCase()}
                </span>

                <div className="upd-row__main">
                  <div className="upd-row__line">
                    <span className="upd-row__name">{name}</span>
                    {u.critical && !isDone && <span className="upd-row__crit">{t("updates.criticalBadge")}</span>}
                    {breaks && <span className="upd-row__breaks">{t("updates.breakingBadge")}</span>}
                  </div>
                  {vendor && <div className="upd-row__vendor">{vendor}</div>}

                  {notes.length > 0 && !run && (
                    <button
                      type="button"
                      className="upd-row__notes-toggle"
                      aria-expanded={open}
                      onClick={() => setOpenNotes((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                    >
                      {t("updates.whatsNew")} <FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} />
                    </button>
                  )}
                  {open && (
                    <div className="upd-row__notes">
                      {notes.map((g, gi) => (
                        <div key={g.version ?? gi} className="upd-row__notegroup">
                          {notes.length > 1 && g.version && (
                            <div className="upd-row__notever">
                              v{g.version}{g.date && <span> · {siteTime.date(g.date)}</span>}
                            </div>
                          )}
                          {CHANGE_ORDER.filter((ty) => g.changes.some((c) => c.type === ty)).map((ty) => {
                            // Text from before typed changes is all "other": no label to show.
                            const untyped = g.changes.every((c) => c.type === "other");
                            return (
                              <div key={ty} className={`upd-change${untyped ? " is-untyped" : ""}`}>
                                {!untyped && <span className={`upd-tag is-${ty}`}>{t(`updates.change.${ty}`)}</span>}
                                <ul>{g.changes.filter((c) => c.type === ty).map((c, i) => <li key={i}>{c.text}</li>)}</ul>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                  {renewal && (
                    <div className="upd-row__warn">
                      <FontAwesomeIcon icon={faTriangleExclamation} /> {t("updates.renewalRequired")}
                    </div>
                  )}
                  {run && (
                    <div className="upd-row__progress" role="status">
                      <div className="upd-row__bar"><span style={{ width: `${Math.max(4, Math.min(100, run.percent))}%` }} /></div>
                      <div className="upd-row__phase">{run.label}</div>
                    </div>
                  )}
                  {queued && <div className="upd-row__queued">{t("updates.queuedHint")}</div>}
                  {failed[id] && !run && !queued && (
                    <div className="upd-row__error">
                      <FontAwesomeIcon icon={faTriangleExclamation} /> {failed[id]}
                    </div>
                  )}
                </div>

                <div className="upd-row__versions">
                  <div className="upd-row__vline">
                    <span className="upd-row__from">{u.installedVersion ?? "?"}</span>
                    <FontAwesomeIcon icon={faArrowRight} className="upd-row__arrow" />
                    <span className="upd-row__to">{u.latestVersion}</span>
                  </div>
                  {(kind || released) && (
                    <div className="upd-row__kind">
                      {[kind && t(`updates.kind.${kind}`), released && siteTime.date(released)].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>

                <div className="upd-row__action">
                  {isDone ? (
                    <span className="upd-row__done"><FontAwesomeIcon icon={faCircleCheck} /> {t("updates.updated")}</span>
                  ) : run || queued ? (
                    <span className="upd-row__busy">
                      <FontAwesomeIcon icon={faCircleNotch} spin /> {run ? t("updates.updating") : t("updates.queued")}
                    </span>
                  ) : renewal ? (
                    <Button variant="ghost" onClick={() => navigate("/admin/license")}>{t("updates.renew")}</Button>
                  ) : (
                    <button
                      type="button"
                      className={`btn-sm ${u.critical ? "btn-danger" : "btn-primary"}`}
                      onClick={() => void start([id])}
                    >
                      {failed[id] ? t("updates.retry") : u.critical ? t("updates.updateNow") : t("updates.update")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/**
 * Security advisories against what this site runs: what is wrong, which versions,
 * and the version that fixes it, with that update one click away. Shown even when
 * no fix exists yet, because "there is no fix, here is what it is" is exactly when
 * an admin needs to know.
 */
function Advisories({ items, updateFor, isBusy, isDone, onFix }: {
  items: Advisory[];
  updateFor: (pluginId: string) => PluginUpdate | undefined;
  isBusy: (pluginId: string) => boolean;
  isDone: (pluginId: string) => boolean;
  onFix: (pluginId: string) => void;
}) {
  const { t } = useTranslation("acp");
  const sorted = [...items].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const open = sorted.filter((a) => !isDone(a.pluginId)).length;
  return (
    <section className="acp-card upd-adv" aria-label={t("updates.advisories.title", { count: items.length })}>
      <div className="upd-adv__head">
        <FontAwesomeIcon icon={faShieldHalved} />
        <span>{open ? t("updates.advisories.title", { count: open }) : t("updates.advisories.resolvedTitle")}</span>
      </div>
      {sorted.map((a) => {
        const fix = updateFor(a.pluginId);
        const done = isDone(a.pluginId);
        const busy = isBusy(a.pluginId);
        return (
          <div key={a.id} className={`upd-adv__row upd-adv__row--${a.severity}`}>
            <div className="upd-adv__body">
              <div className="upd-adv__line">
                <strong>{a.name}</strong>
                <span className="upd-adv__sev">{t(`updates.advisories.severity.${a.severity}`, { defaultValue: a.severity })}</span>
                <code>{a.id}</code>
              </div>
              {a.summary && <p className="upd-adv__text">{a.summary}</p>}
              <div className="upd-adv__meta">
                {t("updates.advisories.affects", { range: a.affects })}
                {" · "}
                {a.fixedIn ? t("updates.advisories.fixedIn", { version: a.fixedIn }) : t("updates.advisories.noFix")}
              </div>
            </div>
            <div className="upd-adv__action">
              {done ? (
                <span className="upd-row__done"><FontAwesomeIcon icon={faCircleCheck} /> {t("updates.advisories.resolved")}</span>
              ) : busy ? (
                <span className="upd-row__busy"><FontAwesomeIcon icon={faCircleNotch} spin /> {t("updates.updating")}</span>
              ) : fix && !fix.renewalRequired ? (
                <Button variant="danger" onClick={() => onFix(a.pluginId)}>
                  {t("updates.advisories.updateTo", { version: fix.latestVersion })}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
