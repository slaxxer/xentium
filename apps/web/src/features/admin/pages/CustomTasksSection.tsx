import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faPlay, faTrash, faPen, faFlask, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { SchemaFields, defaultsFor, type FieldSchema, type FieldValues } from "../../../components/SchemaFields";

type ScheduleMode = "interval" | "daily" | "cron";

interface Schedule {
  mode: ScheduleMode;
  intervalMin?: number;
  dailyTime?: string;
  cron?: string;
  tz?: string;
}

interface ActionView {
  key: string; label: string; description: string; domain: string;
  destructive: boolean; minIntervalSec: number;
  /** null when the Zod schema has no JSON Schema representation. */
  paramsSchema: FieldSchema | null;
}

interface TaskView {
  id: string; name: string;
  actionKey: string; actionLabel: string; destructive: boolean;
  params: FieldValues;
  schedule: Schedule; cron: string;
  enabled: boolean; dryRun: boolean;
  lastRunAt: string | null; lastStatus: string | null;
  nextRuns: string[];
}

interface RunView {
  id: string; startedAt: string; finishedAt: string | null;
  durationMs: number | null; status: string; dryRun: boolean;
  summary: string | null; error: string | null;
}

const TZS = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Asia/Tokyo", "Australia/Sydney"];

/** Short form: the aside has no room for a weekday + full date. */
const fmtShort = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const statusClass = (status: string | null) =>
  `ctask__status ctask__status--${
    status === "ok" || status === "error" || status === "running" ? status : "idle"
  }`;


// ── Create / edit dialog ─────────────────────────────────────────────────────
// An entity modal, not a config surface — so it keeps explicit Save/Cancel per
// the ACP convention (a half-typed name must not create a task).

function TaskDialog({ task, actions, onClose }: {
  task: TaskView | null; actions: ActionView[]; onClose: () => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const initialKey = task?.actionKey ?? actions[0]?.key ?? "";

  const [name, setName]           = useState(task?.name ?? "");
  const [actionKey, setActionKey] = useState(initialKey);
  const [schedule, setSchedule]   = useState<Schedule>(task?.schedule ?? { mode: "daily", dailyTime: "04:00", tz: "UTC" });
  const [dryRun, setDryRun]       = useState(task?.dryRun ?? false);
  // An existing task's stored params win over the defaults; a new one starts
  // from the schema's defaults so the form shows what will actually be applied.
  const [params, setParams]       = useState<FieldValues>(
    task?.params ?? defaultsFor(actions.find((a) => a.key === initialKey)?.paramsSchema),
  );

  const action = actions.find((a) => a.key === actionKey);
  const minMin = Math.round((action?.minIntervalSec ?? 300) / 60);

  /** Switching action must reset params: the old action's values are validated
   *  against the new action's schema on save and would 422 on every field. */
  function pickAction(key: string) {
    setActionKey(key);
    setParams(defaultsFor(actions.find((a) => a.key === key)?.paramsSchema));
  }

  const save = useMutation({
    mutationFn: () => task
      ? api.patch(`/admin/tasks/${task.id}`, { name, actionKey, params, schedule, dryRun })
      : api.post("/admin/tasks", { name, actionKey, params, schedule, dryRun, enabled: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-tasks"] });
      toast.success(t(task ? "tasks.toastUpdated" : "tasks.toastCreated"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const set = (patch: Partial<Schedule>) => setSchedule((s) => ({ ...s, ...patch }));

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>{t(task ? "tasks.editTitle" : "tasks.newTitle")}</h3>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", margin: "0 0 18px" }}>{t("tasks.dialogHint")}</p>

        <div className="acp-form-field">
          <label className="acp-label">{t("tasks.name")}</label>
          <input className="acp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tasks.namePlaceholder")} />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("tasks.action")}</label>
          <select className="acp-input" value={actionKey} onChange={(e) => pickAction(e.target.value)}>
            {actions.map((a) => <option key={a.key} value={a.key}>{a.domain} — {a.label}</option>)}
          </select>
          {action && <div className="acp-hint">{action.description}</div>}
        </div>

        <SchemaFields schema={action?.paramsSchema} values={params} onChange={setParams} />

        {action?.destructive && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 8, background: "color-mix(in srgb, var(--c-danger) 12%, transparent)", marginBottom: 14 }}>
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: "var(--c-danger)", marginTop: 2 }} />
            <div style={{ fontSize: 12.5 }}>{t("tasks.destructiveWarn")}</div>
          </div>
        )}

        {/* Schedule */}
        <div className="acp-form-field">
          <label className="acp-label">{t("tasks.schedule")}</label>
          <select className="acp-input" value={schedule.mode} onChange={(e) => set({ mode: e.target.value as ScheduleMode })}>
            <option value="interval">{t("tasks.modeInterval")}</option>
            <option value="daily">{t("tasks.modeDaily")}</option>
            <option value="cron">{t("tasks.modeCron")}</option>
          </select>
        </div>

        {schedule.mode === "interval" && (
          <div className="acp-form-field">
            <label className="acp-label">{t("tasks.everyMinutes")}</label>
            <input className="acp-input" type="number" min={minMin} value={schedule.intervalMin ?? 60}
              onChange={(e) => set({ intervalMin: Number(e.target.value) })} style={{ width: 160 }} />
            <div className="acp-hint">{t("tasks.minInterval", { n: minMin })}</div>
          </div>
        )}
        {schedule.mode === "daily" && (
          <div className="acp-form-field">
            <label className="acp-label">{t("tasks.atTime")}</label>
            <input className="acp-input" type="time" value={schedule.dailyTime ?? "04:00"}
              onChange={(e) => set({ dailyTime: e.target.value })} style={{ width: 160 }} />
          </div>
        )}
        {schedule.mode === "cron" && (
          <div className="acp-form-field">
            <label className="acp-label">{t("tasks.cronExpr")}</label>
            <input className="acp-input" value={schedule.cron ?? ""} onChange={(e) => set({ cron: e.target.value })} placeholder="0 4 * * *" />
            <div className="acp-hint">{t("tasks.minInterval", { n: minMin })}</div>
          </div>
        )}

        <div className="acp-form-field">
          <label className="acp-label">{t("tasks.timezone")}</label>
          <select className="acp-input" value={schedule.tz ?? "UTC"} onChange={(e) => set({ tz: e.target.value })}>
            {TZS.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 18 }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <b style={{ fontSize: 13 }}>{t("tasks.dryRun")}</b>
            <div className="acp-hint" style={{ marginTop: 2 }}>{t("tasks.dryRunHint")}</div>
          </span>
        </label>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("tasks.cancel")}</button>
          <button type="button" className="btn-primary btn-sm" disabled={!name.trim() || !actionKey || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? t("tasks.saving") : t("tasks.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run history ──────────────────────────────────────────────────────────────

function RunHistory({ taskId }: { taskId: string }) {
  const { t } = useTranslation("acp");
  const { data: runs = [] } = useQuery<RunView[]>({
    queryKey: ["acp-task-runs", taskId],
    queryFn:  () => api.get(`/admin/tasks/${taskId}/runs`),
  });

  if (runs.length === 0) return <div className="ctask__runs ctask__run-time">{t("tasks.noRuns")}</div>;

  // Two lines per run rather than one wide row: the summary is a full sentence
  // and would be unreadable squeezed into what is left of a 360px column.
  return (
    <div className="ctask__runs">
      {runs.slice(0, 6).map((r) => (
        <div key={r.id} className="ctask__run">
          <div className="ctask__run-head">
            <span className={statusClass(r.status)}>{r.status}</span>
            <span className="ctask__run-time">{fmtShort(r.startedAt)}</span>
            {r.durationMs != null && <span className="ctask__run-time">{r.durationMs} ms</span>}
            {r.dryRun && <span className="ctask__run-dry">{t("tasks.dryBadge")}</span>}
          </div>
          {(r.error ?? r.summary) && (
            <div className="ctask__run-text">{r.error ?? r.summary}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Task card ────────────────────────────────────────────────────────────────

function TaskCard({ task, onEdit }: { task: TaskView; onEdit: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["acp-tasks"] });
    qc.invalidateQueries({ queryKey: ["acp-task-runs", task.id] });
  };

  const toggle = useMutation({
    mutationFn: () => api.patch(`/admin/tasks/${task.id}`, { enabled: !task.enabled }),
    onSuccess:  invalidate,
    onError:    (e) => toast.error(apiErrorMessage(e)),
  });

  const run = useMutation({
    // A queued run has to land, be executed and write its row before the list
    // shows anything new — refetch once after a beat rather than immediately.
    mutationFn: (dryRun: boolean) => api.post(`/admin/tasks/${task.id}/run`, { dryRun }),
    onSuccess: () => { toast.success(t("tasks.toastQueued")); setTimeout(invalidate, 1500); },
    onError:   (e) => toast.error(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/tasks/${task.id}`),
    onSuccess: () => { toast.success(t("tasks.toastDeleted")); invalidate(); },
    onError:   (e) => toast.error(apiErrorMessage(e)),
  });

  async function confirmDelete() {
    const ok = await openDialog({
      kind:        "confirm",
      icon:        "warning",
      danger:      true,
      title:       t("tasks.confirmDeleteTitle"),
      body:        t("tasks.confirmDelete", { name: task.name }),
      confirmText: t("tasks.delete"),
      cancelText:  t("tasks.cancel"),
    });
    if (ok) remove.mutate();
  }

  return (
    <div className={`ctask${task.enabled ? "" : " is-disabled"}`}>
      <div className="ctask__name">
        {task.name}
        {task.dryRun && <span className="ctask__badge">{t("tasks.dryBadge")}</span>}
      </div>

      <div className="ctask__meta">
        {task.actionLabel}
        <br />
        <code>{task.cron}</code> · {task.schedule.tz ?? "UTC"}
        {task.enabled && task.nextRuns[0] && <><br />{t("tasks.next")}: {fmtShort(task.nextRuns[0])}</>}
        {task.lastRunAt && (
          <>
            <br />
            {t("tasks.lastRun")}: <span className={statusClass(task.lastStatus)}>{task.lastStatus}</span>
            {" · "}{fmtShort(task.lastRunAt)}
          </>
        )}
      </div>

      <div className="ctask__actions">
        <button type="button" className="btn-ghost btn-sm" title={t("tasks.dryRunNow")} disabled={run.isPending} onClick={() => run.mutate(true)}>
          <FontAwesomeIcon icon={faFlask} />
        </button>
        <button type="button" className="btn-ghost btn-sm" title={t("tasks.runNow")} disabled={run.isPending} onClick={() => run.mutate(false)}>
          <FontAwesomeIcon icon={faPlay} />
        </button>
        <button type="button" className="btn-ghost btn-sm" title={t("tasks.edit")} onClick={onEdit}>
          <FontAwesomeIcon icon={faPen} />
        </button>
        <button type="button" className="btn-ghost btn-sm ctask__danger" title={t("tasks.delete")} onClick={() => void confirmDelete()}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
        <button type="button" className="btn-ghost btn-sm ctask__toggle" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {task.enabled ? t("tasks.disable") : t("tasks.enable")}
        </button>
      </div>

      <button type="button" className="btn-ghost btn-sm ctask__history-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? t("tasks.hideHistory") : t("tasks.showHistory")}
      </button>
      {open && <RunHistory taskId={task.id} />}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function CustomTasksSection() {
  const { t } = useTranslation("acp");
  const [dialog, setDialog] = useState<{ task: TaskView | null } | null>(null);

  const { data: tasks = [], isLoading, error } = useQuery<TaskView[]>({
    queryKey: ["acp-tasks"],
    queryFn:  () => api.get("/admin/tasks"),
    retry:    false,
  });
  const { data: actions = [] } = useQuery<ActionView[]>({
    queryKey: ["acp-task-actions"],
    queryFn:  () => api.get("/admin/tasks/actions"),
    retry:    false,
  });

  // The whole section is gated on system.tasks.manage; an admin without it just
  // doesn't see it rather than getting a wall of 403s. Only a 403 hides it — a
  // network blip must not silently make a configured task list disappear.
  if ((error as { status?: number } | null)?.status === 403) return null;

  return (
    <aside className="ctask-panel">
      <div className="ctask-panel__head">
        <h2 className="ctask-panel__title">{t("tasks.title")}</h2>
        {tasks.length > 0 && <span className="ctask-panel__count">{tasks.length}</span>}
      </div>
      <p className="ctask-panel__sub">{t("tasks.subtitle")}</p>

      <button type="button" className="btn-primary btn-sm ctask-panel__new"
        disabled={actions.length === 0} onClick={() => setDialog({ task: null })}>
        <FontAwesomeIcon icon={faPlus} />
        {t("tasks.new")}
      </button>

      {isLoading ? (
        <div className="ctask-empty">{t("tasks.loading")}</div>
      ) : error ? (
        <div className="ctask-error">{apiErrorMessage(error)}</div>
      ) : tasks.length === 0 ? (
        <div className="ctask-empty">{t("tasks.empty")}</div>
      ) : (
        <div className="ctask-list">
          {tasks.map((task) => <TaskCard key={task.id} task={task} onEdit={() => setDialog({ task })} />)}
        </div>
      )}

      {dialog && <TaskDialog task={dialog.task} actions={actions} onClose={() => setDialog(null)} />}
    </aside>
  );
}
