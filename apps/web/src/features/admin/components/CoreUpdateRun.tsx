import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faArrowRight, faCheck, faDownload, faRotateLeft, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { CorePermissions } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Button } from "../../../components/AcpControls";
import { api, holdFatalErrors } from "../../../lib/api";
import { userCan } from "../../../lib/authStore";
import { apiErrorMessage } from "../../../lib/swal";
import { useAuth } from "../../../hooks/useAuth";
import "./CoreUpdate.scss";

/**
 * One-click core updates in the ACP.
 *
 * The API only ASKS: Update now writes a request, and the updater on the server
 * (set up by `xentium install-service`) does the work and writes a status file.
 * This file reads that status: `useCoreUpdateRun` polls it, `RunProgress` draws
 * it (the update dialog and Migration History show the same view), and
 * `CoreUpdateRunDialog` walks an admin from "confirm it's you" to the end.
 *
 * The API restarts during an update. A poll that fails while a run is going is
 * that restart, not an error: the view keeps the last status and says it is
 * reconnecting.
 */

type StepKey = "check" | "cli" | "download" | "install" | "verify" | "backup" | "migrate" | "restart" | "health" | "restore" | "switch-back";
type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface RunStatus {
  v: 1;
  id: string;
  action: "update" | "rollback";
  from: string;
  to: string;
  state: "running" | "done" | "failed" | "rolled-back";
  requestedBy: { id: string; username: string } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  steps: Array<{ key: StepKey; state: StepState; startedAt?: string; finishedAt?: string; note?: string }>;
  packages: Array<{ name: string; from: string | null; to: string; size: number | null; received: number; state: "queued" | "downloading" | "done" }>;
  otherPackages: number | null;
  migrations: Array<{ name: string; state: "waiting" | "running" | "done" | "failed" }>;
  backup: string | null;
  error: string | null;
  log: string[];
}

export interface RunView {
  available: boolean;
  unavailableReason: "not-cli-install" | "no-updater" | null;
  queued: boolean;
  status: RunStatus | null;
  stalled: boolean;
  running: string;
  offered: string | null;
}

export const RUN_KEY = ["acp-core-update-run"] as const;

/** The run, polled every second while one is going (and once a minute otherwise). */
export function useCoreUpdateRun(enabled = true) {
  const last = useRef<RunView | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const query = useQuery<RunView>({
    queryKey: RUN_KEY,
    queryFn: async () => {
      try {
        const v = await api.get<RunView>("/admin/core-update/run");
        last.current = v;
        setReconnecting(false);
        // The restart answers 502 for a moment: no fatal overlay while a run is going.
        holdFatalErrors(v.queued || v.status?.state === "running");
        return v;
      } catch (e) {
        // The API is down for the restart in the middle of an update: keep showing the run.
        if (last.current && (last.current.queued || last.current.status?.state === "running")) {
          setReconnecting(true);
          return last.current;
        }
        throw e;
      }
    },
    enabled,
    refetchInterval: (q) => {
      const v = q.state.data;
      return v && (v.queued || v.status?.state === "running") ? 1000 : 60_000;
    },
    refetchIntervalInBackground: true,
  });
  return { ...query, reconnecting };
}

// ── Opening the dialog from anywhere ────────────────────────────────────────

let dialogOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function openCoreUpdateRun() { dialogOpen = true; emit(); }
function closeCoreUpdateRun() { dialogOpen = false; emit(); }
function useDialogOpen() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => dialogOpen);
}

/** Mounted once in the ACP shell. Reopens the dialog for the admin whose update is running. */
export function CoreUpdateRunHost() {
  const open = useDialogOpen();
  const { user } = useAuth();
  const run = useCoreUpdateRun(!!user && userCan(user, CorePermissions.SYSTEM_UPDATE));
  const reopened = useRef<string | null>(null);
  const s = run.data?.status;
  useEffect(() => {
    // Whoever started a run that is still going sees it again after a reload.
    if (s && s.state === "running" && s.requestedBy?.id === user?.id && reopened.current !== s.id) {
      reopened.current = s.id;
      openCoreUpdateRun();
    }
  }, [s, user?.id]);
  return open ? <CoreUpdateRunDialog onClose={closeCoreUpdateRun} /> : null;
}

// ── The shared progress view ────────────────────────────────────────────────

const UPDATE_ORDER: StepKey[] = ["check", "cli", "download", "install", "verify", "backup", "migrate", "restart", "health"];

function fmtSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

function elapsed(from: string, to: string | null) {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How far along a run is, from its steps (a running step counts half). */
function progressOf(s: RunStatus): number {
  if (s.state !== "running") return 100;
  const steps = s.steps.filter((x) => x.state !== "skipped");
  if (steps.length === 0) return 0;
  let n = 0;
  for (const st of steps) {
    if (st.state === "done" || st.state === "failed") n += 1;
    else if (st.state === "running") {
      if (st.key === "download" && s.packages.length) {
        const total = s.packages.reduce((a, p) => a + (p.size ?? 0), 0);
        const got = s.packages.reduce((a, p) => a + p.received, 0);
        n += total ? got / total : 0.5;
      } else n += 0.5;
    }
  }
  return Math.min(99, Math.round((n / steps.length) * 100));
}

export function RunProgress({ status, reconnecting, showLogByDefault = false }: { status: RunStatus; reconnecting?: boolean; showLogByDefault?: boolean }) {
  const { t } = useTranslation("acp");
  const [showLog, setShowLog] = useState(showLogByDefault);
  const [, tick] = useState(0);
  const running = status.state === "running";
  // The clock moves between polls.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Keep the step that is running in view: the list is taller than the dialog.
  const activeKey = status.steps.find((x) => x.state === "running")?.key;
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);

  const pct = progressOf(status);
  const order = status.action === "update" ? UPDATE_ORDER : [];
  const steps = [...status.steps].sort((a, b) => {
    const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const active = steps.find((s) => s.state === "running");
  const totalBytes = status.packages.reduce((a, p) => a + (p.size ?? 0), 0);
  const gotBytes = status.packages.reduce((a, p) => a + p.received, 0);
  const pkgDone = status.packages.filter((p) => p.state === "done").length;
  const label = status.state === "done" ? t("coreUpdate.run.overallDone", { time: elapsed(status.startedAt, status.finishedAt) })
    : status.state === "running" ? (active ? `${t(`coreUpdate.run.step.${active.key}`)}…` : t("coreUpdate.run.starting"))
    : status.state === "rolled-back" ? t("coreUpdate.run.overallRolledBack") : t("coreUpdate.run.overallFailed");

  return (
    <div className={`cur-progress is-${status.state}`}>
      <div className="cur-overall">
        <div className="cur-overall__head">
          <b>{label}</b>
          <span>{pct}% · {elapsed(status.startedAt, status.finishedAt)}</span>
        </div>
        <div className="cur-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("coreUpdate.run.progressLabel")}>
          <div className={`cur-bar__fill${running ? " is-moving" : ""}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ol className="cur-steps">
        {steps.map((s) => (
          <li key={s.key} ref={s.key === activeKey ? activeRef : undefined}
            className={`cur-step is-${s.state}${s.key === "restore" || s.key === "switch-back" ? " is-undo" : ""}`}>
            <div className="cur-step__row">
              <span className="cur-step__dot" aria-hidden="true">
                {s.state === "done" && <FontAwesomeIcon icon={faCheck} />}
                {s.state === "failed" && <FontAwesomeIcon icon={faXmark} />}
                {s.state === "running" && <span className="cur-spin" />}
              </span>
              <span className="cur-step__text">
                <b>{t(`coreUpdate.run.step.${s.key}`)}</b>
                <span>{s.note ?? t(`coreUpdate.run.stepNote.${s.key}`, { version: status.to, from: status.from, defaultValue: "" })}</span>
              </span>
              <span className="cur-step__state">{t(`coreUpdate.run.state.${s.state}`)}</span>
            </div>

            {s.key === "download" && status.packages.length > 0 && s.state !== "waiting" && (
              <div className="cur-pkgs">
                <div className="cur-pkgs__head">
                  <FontAwesomeIcon icon={faDownload} className={s.state === "running" ? "cur-drop" : ""} />
                  <span>{t("coreUpdate.run.packagesSummary", { done: pkgDone, total: status.packages.length, got: fmtSize(gotBytes), size: fmtSize(totalBytes || gotBytes) })}</span>
                </div>
                {status.packages.map((p) => {
                  const f = p.size ? Math.min(1, p.received / p.size) : p.state === "done" ? 1 : 0;
                  return (
                    <div key={p.name} className={`cur-pkg is-${p.state}`}>
                      <span className="cur-pkg__name">{p.name}</span>
                      <span className="cur-pkg__ver">{p.from ?? "–"} → <b>{p.to}</b></span>
                      <span className="cur-pkg__bar"><span className={p.state === "downloading" ? "is-moving" : ""} style={{ width: `${Math.round(f * 100)}%` }} /></span>
                      <span className="cur-pkg__size">
                        {p.state === "queued" ? t("coreUpdate.run.queued") : p.size ? (p.state === "done" ? fmtSize(p.size) : `${fmtSize(p.received)}/${fmtSize(p.size)}`) : fmtSize(p.received)}
                      </span>
                      <span className="cur-pkg__ok" aria-label={t(`coreUpdate.run.pkg.${p.state}`)}>{p.state === "done" && <FontAwesomeIcon icon={faCheck} />}</span>
                    </div>
                  );
                })}
                {status.otherPackages ? <div className="cur-pkgs__more">{t("coreUpdate.run.otherPackages", { count: status.otherPackages })}</div> : null}
              </div>
            )}

            {s.key === "migrate" && status.migrations.length > 0 && s.state !== "waiting" && (
              <div className="cur-pkgs">
                {status.migrations.map((m) => (
                  <div key={m.name} className={`cur-mig is-${m.state}`}>
                    <span className="cur-mig__dot" aria-hidden="true" />
                    <span className="cur-mig__name">{m.name}</span>
                    <span className="cur-mig__state">{t(`coreUpdate.run.migState.${m.state}`)}</span>
                  </div>
                ))}
              </div>
            )}

            {(s.key === "restart" || s.key === "health") && s.state === "running" && reconnecting && (
              <div className="cur-reconnect">{t("coreUpdate.run.reconnecting")}</div>
            )}
          </li>
        ))}
      </ol>

      {status.error && status.state !== "done" && (
        <div className="cur-error">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <div>
            <b>{t(status.state === "rolled-back" ? "coreUpdate.run.errorRolledBack" : "coreUpdate.run.errorFailed", { from: status.from })}</b>
            <code>{status.error}</code>
          </div>
        </div>
      )}

      {status.log.length > 0 && (
        <>
          <button type="button" className="cur-logtoggle" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            {t(showLog ? "coreUpdate.run.hideLog" : "coreUpdate.run.showLog")}
          </button>
          {showLog && <pre className="cur-log">{status.log.join("\n")}</pre>}
        </>
      )}
    </div>
  );
}

// ── The dialog ─────────────────────────────────────────────────────────────

export function CoreUpdateRunDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const run = useCoreUpdateRun();
  const [password, setPassword] = useState("");
  const [asked, setAsked] = useState(false);
  const [previousRun, setPreviousRun] = useState<string | null>(null);
  const view = run.data;
  const status = view?.status ?? null;
  // The dialog shows a run that is going, or the one it started; never an old
  // finished run, which would otherwise greet every new update.
  const showRun = !!status && (status.state === "running" || (asked && status.id !== previousRun));
  const phase: "confirm" | "queued" | "running" | "done" | "failed" =
    view?.queued ? "queued"
    : showRun && status ? (status.state === "running" ? "running" : status.state === "done" ? "done" : "failed")
    : "confirm";

  const start = useMutation({
    mutationFn: () => api.post<RunView>("/admin/core-update/run", { version: view?.offered, password }),
    onMutate: () => setPreviousRun(view?.status?.id ?? null),
    onSuccess: (v) => { setPassword(""); setAsked(true); qc.setQueryData(RUN_KEY, v); },
  });

  const closable = phase !== "running" && phase !== "queued";
  const version = status && showRun ? status.to : view?.offered ?? "";
  const title = phase === "done" ? t(status?.action === "rollback" ? "coreUpdate.run.titleRolledBackDone" : "coreUpdate.run.titleDone", { version })
    : phase === "failed" ? t(status?.state === "rolled-back" ? "coreUpdate.run.titleRolledBack" : "coreUpdate.run.titleFailed")
    : phase === "running" || phase === "queued" ? t(status?.action === "rollback" ? "coreUpdate.run.titleRollingBack" : "coreUpdate.run.titleRunning", { version })
    : t("coreUpdate.run.titleConfirm", { version });
  const sub = t(`coreUpdate.run.sub.${phase}`, { from: status?.from ?? view?.running ?? "" });
  const err = start.error;

  return (
    <div className="acp-modal-overlay" onClick={closable ? onClose : undefined}>
      <section className="acp-modal cur-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="cur-dialog__head">
          <span className={`cur-dialog__icon is-${phase}`} aria-hidden="true">
            <FontAwesomeIcon icon={phase === "done" ? faCheck : phase === "failed" ? faRotateLeft : faDownload} />
          </span>
          <div className="cur-dialog__titles">
            <h2>{title}</h2>
            <p>{sub}</p>
          </div>
          {closable && (
            <button type="button" className="cur-dialog__close" onClick={onClose} aria-label={t("coreUpdate.run.close")}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </header>

        <div className="cur-dialog__body">
          {!view ? (
            <p className="cur-muted">{t("coreUpdate.run.loading")}</p>
          ) : phase === "confirm" ? (
            !view.available ? (
              <div className="cur-setup">
                <p>{t(view.unavailableReason === "not-cli-install" ? "coreUpdate.run.notCli" : "coreUpdate.run.noUpdater")}</p>
                {view.unavailableReason === "no-updater" && <pre className="cur-cmd">{`npm install xentium@${view.offered ?? view.running}\nnpx xentium install-service`}</pre>}
              </div>
            ) : !view.offered ? (
              <p className="cur-muted">{t("coreUpdate.run.nothingOffered", { version: view.running })}</p>
            ) : (
              <>
                <div className="cur-versions">
                  <span>{view.running}</span>
                  <FontAwesomeIcon icon={faArrowRight} />
                  <b>{view.offered}</b>
                </div>
                <ol className="cur-promises">
                  {(["backup", "download", "migrate", "undo"] as const).map((k, i) => (
                    <li key={k}>
                      <span className="cur-promises__n">{i + 1}</span>
                      <span><b>{t(`coreUpdate.run.promise.${k}`)}</b><small>{t(`coreUpdate.run.promise.${k}Desc`)}</small></span>
                    </li>
                  ))}
                </ol>
                <form className="cur-reauth" onSubmit={(e) => { e.preventDefault(); if (password) start.mutate(); }}>
                  <label htmlFor="cur-pw"><b>{t("coreUpdate.run.reauth")}</b><small>{t("coreUpdate.run.reauthDesc")}</small></label>
                  <input id="cur-pw" className="inp" type="password" autoComplete="current-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder={t("coreUpdate.run.passwordPh")} autoFocus />
                </form>
              </>
            )
          ) : phase === "queued" ? (
            <p className="cur-muted cur-wait">{t("coreUpdate.run.queuedNote")}</p>
          ) : status ? (
            <RunProgress status={status} reconnecting={run.reconnecting} />
          ) : null}
          {err && <p className="cur-formerror" role="alert">{apiErrorMessage(err)}</p>}
        </div>

        <footer className="cur-dialog__foot">
          <span className="cur-muted">
            {phase === "confirm" && view?.available && view.offered ? t("coreUpdate.run.footConfirm")
              : phase === "running" || phase === "queued" ? t("coreUpdate.run.footRunning")
              : phase === "done" && status?.backup ? t("coreUpdate.run.footBackup", { file: status.backup }) : ""}
          </span>
          {phase === "confirm" && (
            <>
              <Button variant="ghost" onClick={onClose}>{t("coreUpdate.run.cancel")}</Button>
              {view?.available && view.offered && (
                <Button icon={faDownload} disabled={!password || start.isPending} onClick={() => start.mutate()}>
                  {t("coreUpdate.run.updateTo", { version: view.offered })}
                </Button>
              )}
            </>
          )}
          {(phase === "running" || phase === "queued") && (
            <Link className="btn-ghost" to="/admin/migration-history" onClick={onClose}>{t("coreUpdate.run.follow")}</Link>
          )}
          {phase === "done" && (
            <>
              <Link className="btn-ghost" to="/admin/migration-history" onClick={onClose}>{t("coreUpdate.run.history")}</Link>
              <Button onClick={() => { onClose(); window.location.reload(); }}>{t("coreUpdate.run.reload")}</Button>
            </>
          )}
          {phase === "failed" && (
            <>
              <Link className="btn-ghost" to="/admin/migration-history" onClick={onClose}>{t("coreUpdate.run.openLog")}</Link>
              <Button onClick={onClose}>{t("coreUpdate.run.close")}</Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

// ── Migration History ──────────────────────────────────────────────────────

/**
 * The top of System → Migration History: the update on offer (Update now opens
 * the dialog), and the latest update or rollback the updater ran, live while it
 * runs. A finished update can be rolled back from here, with the password again.
 */
export function CoreUpdateRunCard() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { user } = useAuth();
  const allowed = userCan(user, CorePermissions.SYSTEM_UPDATE);
  const run = useCoreUpdateRun(allowed);
  const [askPw, setAskPw] = useState(false);
  const [password, setPassword] = useState("");
  const rollback = useMutation({
    mutationFn: () => api.post<RunView>("/admin/core-update/rollback", { password }),
    onSuccess: (v) => { setPassword(""); setAskPw(false); qc.setQueryData(RUN_KEY, v); },
  });
  const view = run.data;
  if (!allowed || !view) return null;
  const s = view.status;
  const going = view.queued || s?.state === "running";
  const canRollback = !going && view.available && s?.action === "update" && s.state === "done" && s.to === view.running;

  return (
    <div className="cur-history">
      {view.offered && !going && (
        <div className="cur-offer">
          <FontAwesomeIcon icon={faDownload} />
          <span className="cur-offer__text">
            <b>{t("coreUpdate.run.offerTitle", { version: view.offered })}</b>
            <small>{view.available ? t("coreUpdate.run.offerSub", { from: view.running }) : t(view.unavailableReason === "not-cli-install" ? "coreUpdate.run.notCli" : "coreUpdate.run.noUpdaterShort")}</small>
          </span>
          {view.available && <Button icon={faDownload} onClick={openCoreUpdateRun}>{t("coreUpdate.run.updateNow")}</Button>}
        </div>
      )}

      {s && (
        <section className="mh-card cur-runcard" aria-label={t("coreUpdate.run.cardLabel")}>
          <header className="cur-runcard__head">
            <div>
              <h2>{t(s.action === "rollback" ? "coreUpdate.run.cardRollback" : "coreUpdate.run.cardUpdate", { from: s.from, to: s.to })}</h2>
              <p>{t("coreUpdate.run.cardMeta", { who: s.requestedBy?.username ?? "–", when: new Date(s.startedAt).toLocaleString() })}{s.backup ? ` · ${s.backup}` : ""}</p>
            </div>
            <span className={`cur-chip is-${view.stalled ? "failed" : s.state}`}>{t(view.stalled ? "coreUpdate.run.chip.stalled" : `coreUpdate.run.chip.${s.state}`)}</span>
            {canRollback && !askPw && (
              <Button variant="ghost" icon={faRotateLeft} onClick={() => setAskPw(true)}>{t("coreUpdate.run.rollbackTo", { version: s.from })}</Button>
            )}
          </header>
          {askPw && (
            <form className="cur-rollback" onSubmit={(e) => { e.preventDefault(); if (password) rollback.mutate(); }}>
              <span className="cur-muted">{t("coreUpdate.run.rollbackNote", { version: s.from })}</span>
              <input className="inp" type="password" autoComplete="current-password" value={password} autoFocus
                onChange={(e) => setPassword(e.target.value)} placeholder={t("coreUpdate.run.passwordPh")} aria-label={t("coreUpdate.run.reauth")} />
              <Button variant="ghost" onClick={() => { setAskPw(false); setPassword(""); }}>{t("coreUpdate.run.cancel")}</Button>
              <Button type="submit" disabled={!password || rollback.isPending}>{t("coreUpdate.run.rollbackConfirm")}</Button>
              {rollback.error && <span className="cur-formerror" role="alert">{apiErrorMessage(rollback.error)}</span>}
            </form>
          )}
          {view.stalled && <p className="cur-formerror">{t("coreUpdate.run.stalledNote")}</p>}
          <RunProgress status={s} reconnecting={run.reconnecting} />
        </section>
      )}
    </div>
  );
}
