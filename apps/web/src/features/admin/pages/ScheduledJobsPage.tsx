import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock, faPlay, faCheck, faCircleExclamation, faPause } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast } from "../../../lib/swal";

type ScheduleMode = "interval" | "daily" | "cron";
interface JobConfig {
  enabled: boolean;
  mode: ScheduleMode;
  intervalMin?: number;
  dailyTime?: string;
  cron?: string;
  tz?: string;
}
interface JobView {
  key: string;
  label: string;
  description: string;
  defaultCron: string;
  minIntervalSec: number;
  config: JobConfig;
  pattern: string | null;
  nextRuns: string[];
  valid: boolean;
  error: string | null;
  lastRun: { at: number | null; status: "completed" | "failed" | null };
}

const TZS = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Asia/Tokyo", "Australia/Sydney"];

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtMs(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Which radio is selected, derived from a config. */
function presetOf(c: JobConfig): string {
  if (c.mode === "cron") return "cron";
  if (c.mode === "daily") return "daily";
  if (c.intervalMin === 15) return "i15";
  if (c.intervalMin === 60) return "hourly";
  return "i30";
}

function JobCard({ job }: { job: JobView }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<JobConfig>(job.config);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const preset = presetOf(cfg);
  const minMin = Math.round(job.minIntervalSec / 60);

  function setPreset(p: string) {
    if (p === "i15") setCfg({ ...cfg, mode: "interval", intervalMin: 15 });
    else if (p === "i30") setCfg({ ...cfg, mode: "interval", intervalMin: 30 });
    else if (p === "hourly") setCfg({ ...cfg, mode: "interval", intervalMin: 60 });
    else if (p === "daily") setCfg({ ...cfg, mode: "daily", dailyTime: cfg.dailyTime ?? "02:00" });
    else setCfg({ ...cfg, mode: "cron", cron: cfg.cron ?? job.pattern ?? job.defaultCron });
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/admin/jobs/${job.key}`, cfg);
      await qc.invalidateQueries({ queryKey: ["acp-jobs"] });
      swalToast(t("scheduled.scheduleSaved"), "success");
    } catch (err: any) {
      swalToast(err?.detail?.error?.message ?? err?.detail?.message ?? t("scheduled.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      await api.post(`/admin/jobs/${job.key}/run`);
      swalToast(t("scheduled.queuedToRun", { label: job.label }), "success");
    } catch {
      swalToast(t("scheduled.triggerFailed"), "error");
    } finally {
      setRunning(false);
    }
  }

  const radio = (id: string, label: React.ReactNode) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-fg)", cursor: "pointer", opacity: cfg.enabled ? 1 : 0.5 }}>
      <input type="radio" name={`mode-${job.key}`} checked={preset === id} disabled={!cfg.enabled} onChange={() => setPreset(id)} />
      {label}
    </label>
  );

  return (
    <div className="acp-card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-fg)", display: "flex", alignItems: "center", gap: 8 }}>
            <FontAwesomeIcon icon={faClock} style={{ color: "var(--c-accent)" }} />
            {job.label}
            {!cfg.enabled && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: "color-mix(in srgb, var(--c-fg-muted) 18%, transparent)", color: "var(--c-fg-muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
                <FontAwesomeIcon icon={faPause} /> {t("scheduled.disabled")}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--c-fg-muted)", marginTop: 4, maxWidth: 560 }}>{job.description}</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--c-fg)", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          {t("scheduled.enabled")}
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 16, alignItems: "center" }}>
        {radio("i15", t("scheduled.every15"))}
        {radio("i30", t("scheduled.every30"))}
        {radio("hourly", t("scheduled.hourly"))}
        {radio("daily", (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {t("scheduled.dailyAt")}
            <input type="time" value={cfg.dailyTime ?? "02:00"} disabled={!cfg.enabled || preset !== "daily"}
              onChange={(e) => setCfg({ ...cfg, mode: "daily", dailyTime: e.target.value })}
              style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-fg)", fontSize: 13 }} />
          </span>
        ))}
        {radio("cron", t("scheduled.advanced"))}
      </div>

      {preset === "cron" && (
        <div style={{ marginTop: 12 }}>
          <input type="text" value={cfg.cron ?? ""} disabled={!cfg.enabled} placeholder={job.defaultCron}
            onChange={(e) => setCfg({ ...cfg, mode: "cron", cron: e.target.value })}
            style={{ width: 240, fontFamily: "monospace", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-fg)", fontSize: 13 }} />
          <span style={{ fontSize: 12, color: "var(--c-fg-muted)", marginLeft: 10 }}>{t("scheduled.cronHint", { min: minMin })}</span>
        </div>
      )}

      {(preset === "daily" || preset === "cron") && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-fg-muted)" }}>
          {t("scheduled.timezone")}
          <select value={cfg.tz ?? "UTC"} disabled={!cfg.enabled} onChange={(e) => setCfg({ ...cfg, tz: e.target.value })}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-fg)", fontSize: 13 }}>
            {TZS.map((t) => <option key={t} value={t}>{t}</option>)}
            {cfg.tz && !TZS.includes(cfg.tz) && <option value={cfg.tz}>{cfg.tz}</option>}
          </select>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--c-border)", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
          {!job.valid && job.error ? (
            <span style={{ color: "var(--c-danger)" }}><FontAwesomeIcon icon={faCircleExclamation} /> {job.error}</span>
          ) : job.nextRuns.length > 0 ? (
            <>{t("scheduled.nextRun")} <b style={{ color: "var(--c-fg)" }}>{fmt(job.nextRuns[0]!)}</b>{job.pattern && <span style={{ fontFamily: "monospace", marginLeft: 8 }}>({job.pattern})</span>}</>
          ) : (
            <>{t("scheduled.notScheduled")}</>
          )}
          <span style={{ marginLeft: 14 }}>
            {job.lastRun.at
              ? <>{t("scheduled.lastPrefix")} {fmtMs(job.lastRun.at)} <FontAwesomeIcon icon={job.lastRun.status === "failed" ? faCircleExclamation : faCheck} style={{ color: job.lastRun.status === "failed" ? "var(--c-danger)" : "var(--c-success)" }} /></>
              : t("scheduled.lastNever")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" type="button" onClick={runNow} disabled={running}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FontAwesomeIcon icon={faPlay} /> {running ? t("scheduled.queuing") : t("scheduled.runNow")}
          </button>
          <button className="btn-primary" type="button" onClick={save} disabled={saving}>
            {saving ? t("scheduled.saving") : t("scheduled.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduledJobsPage() {
  const { t } = useTranslation("acp");
  const { data: jobs = [], isLoading } = useQuery<JobView[]>({
    queryKey: ["acp-jobs"],
    queryFn:  () => api.get("/admin/jobs"),
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("scheduled.title")}</h1>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--c-fg-muted)", margin: "0 0 18px", maxWidth: 640 }}>
        {t("scheduled.subtitle")}
      </p>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("scheduled.loading")}</div>
      ) : (
        jobs.map((job) => <JobCard key={job.key} job={job} />)
      )}
    </div>
  );
}
