import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowsRotate, faCheck, faChevronRight, faCircleExclamation, faCircleXmark,
  faClock, faCompress, faCopy, faDatabase, faDownload, faExpand, faFileImport, faMagnifyingGlass,
  faMinus, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import {
  analyseCore, buildLog, durationOf, effectiveStatus, entityKey, formatDuration, groupByDay,
  groupIssues, inLoadOrder, isCore, matchesQuery, matchesType, packageOf, startedOf,
  type EffectiveStatus, type Filters, type HistoryResponse, type MigrationRun, type SchemaStatus,
  type StatusFilter, type TypeFilter,
} from "./migrationHistory/model";
import "./acpSystem.scss";
import "./MigrationHistory.scss";

// ACP → System → Migration History: every schema deploy and platform import,
// as a list you can filter and a detail pane with the run's log. A running
// import is polled and shown live; see migrationHistory/model.ts for the rules.

const STATUS_ICON: Record<EffectiveStatus, IconDefinition> = {
  running: faArrowsRotate, completed: faCheck, partial: faTriangleExclamation,
  failed: faCircleXmark, stalled: faCircleExclamation,
};
const STATUS_FILTERS: StatusFilter[] = ["all", "running", "completed", "partial", "failed", "stalled"];
const TYPE_FILTERS: TypeFilter[] = ["all", "core", "import"];

/** One re-render a second while something is live, so elapsed times move. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [copied, (key, text) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1400);
  }];
}

export function MigrationHistoryPage() {
  const { t, i18n } = useTranslation("acp");
  const locale = i18n.language;

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ["acp-migration-history"],
    queryFn:  () => api.get("/admin/migration-history"),
    // Poll only while an import is actually alive; a dead one stops the polling too.
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((r) => effectiveStatus(r, Date.now()) === "running") ? 2000 : false;
    },
  });
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const live = runs.some((r) => r.status === "running");
  const now = useNow(live);

  const [filters, setFilters] = useState<Filters>({ q: "", type: "all", status: "all" });
  const [selId, setSelId] = useState<string | null>(null);

  const fmt = useMemo(() => ({
    time: (d: Date, sec = false) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: sec ? "2-digit" : undefined }),
    day:  (d: Date) => d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }),
    short:(d: Date) => d.toLocaleDateString(locale, { month: "short", day: "numeric" }),
  }), [locale]);

  const views = useMemo(() => runs.map((run) => {
    const status = effectiveStatus(run, now);
    return { run, status, dur: formatDuration(durationOf(run, status, now)) };
  }), [runs, now]);

  const filtered = views.filter(({ run, status }) =>
    matchesType(run, filters.type) && matchesQuery(run, filters.q)
    && (filters.status === "all" || status === filters.status));

  const selected = views.find((v) => v.run.id === selId) ?? filtered[0] ?? views[0] ?? null;

  const dayLabel = (d: Date) => {
    const today = new Date(now);
    const yesterday = new Date(now); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("migrations.today");
    if (d.toDateString() === yesterday.toDateString()) return t("migrations.yesterday");
    return fmt.day(d);
  };

  return (
    <div className="mh-page">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.system")}</p>
          <h1 className="pg-title">{t("migrations.title")}</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("migrations.loading")}</div>
      ) : (
        <>
          <Stats views={views} schema={data?.schema ?? null} fmt={fmt} />

          {runs.length === 0 ? (
            <div className="mh-card mh-empty">
              <FontAwesomeIcon icon={faDatabase} className="mh-empty__icon" />
              <div className="mh-empty__title">{t("migrations.emptyTitle")}</div>
              <div className="mh-empty__hint">{t("migrations.emptyHint")}</div>
            </div>
          ) : (
            <div className="mh-split">
              <aside className="mh-card mh-list">
                <label className="mh-search">
                  <FontAwesomeIcon icon={faMagnifyingGlass} />
                  <input
                    value={filters.q}
                    onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                    placeholder={t("migrations.search")}
                    aria-label={t("migrations.search")}
                  />
                </label>

                <div className="mh-seg" role="tablist">
                  {TYPE_FILTERS.map((type) => (
                    <button
                      key={type} role="tab" aria-selected={filters.type === type}
                      className={filters.type === type ? "is-on" : ""}
                      onClick={() => setFilters({ ...filters, type })}
                    >
                      {t(`migrations.type.${type}`)}
                      <span className="mh-seg__n">{views.filter((v) => matchesType(v.run, type)).length}</span>
                    </button>
                  ))}
                </div>

                <div className="mh-chips">
                  {STATUS_FILTERS.map((status) => {
                    const n = views.filter((v) => matchesType(v.run, filters.type) && matchesQuery(v.run, filters.q) && v.status === status).length;
                    if (status === "stalled" && n === 0 && filters.status !== "stalled") return null;
                    return (
                      <button
                        key={status}
                        className={`mh-chip mh-chip--${status}${filters.status === status ? " is-on" : ""}`}
                        onClick={() => setFilters({ ...filters, status })}
                      >
                        <span className="mh-chip__dot" />
                        {t(status === "all" ? "migrations.status.all" : `migrations.status.${status}`)}
                        {status !== "all" && <span className="mh-chip__n">{n}</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="mh-runs">
                  {filtered.length === 0 ? (
                    <div className="mh-nomatch">
                      <div>{t("migrations.noMatch")}</div>
                      <button className="btn-ghost btn-sm" onClick={() => setFilters({ q: "", type: "all", status: "all" })}>
                        {t("migrations.clearFilters")}
                      </button>
                    </div>
                  ) : groupByDay(filtered, (v) => startedOf(v.run)).map((group) => (
                    <div key={group.day.toISOString()} className="mh-group">
                      <div className="mh-group__label">{dayLabel(group.day)}</div>
                      {group.items.map(({ run, status, dur }) => (
                        <button
                          key={run.id}
                          className={`mh-run${selected?.run.id === run.id ? " is-selected" : ""}`}
                          onClick={() => setSelId(run.id)}
                        >
                          <KindIcon run={run} />
                          <span className="mh-run__main">
                            <span className={`mh-run__title${isCore(run) ? " is-mono" : ""}`}>{titleOf(run, t)}</span>
                            <span className="mh-run__sub">
                              {isCore(run) ? t("migrations.sub.core") : t("migrations.sub.import", { pkg: packageOf(run).replace("@xentium/", "") })} · {dur}
                            </span>
                          </span>
                          <span className="mh-run__side">
                            <span className="mh-run__time">{fmt.time(startedOf(run))}</span>
                            <span className={`mh-st mh-st--${status}`}>
                              <FontAwesomeIcon icon={STATUS_ICON[status]} spin={status === "running"} />
                              {t(`migrations.status.${status}`)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </aside>

              {selected && <Detail key={selected.run.id} run={selected.run} status={selected.status} dur={selected.dur} fmt={fmt} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Fmt = { time: (d: Date, sec?: boolean) => string; day: (d: Date) => string; short: (d: Date) => string };
type T = ReturnType<typeof useTranslation>["t"];

function titleOf(run: MigrationRun, t: T): string {
  if (isCore(run)) return "migrate deploy";
  return run.sourceInfo ?? t("migrations.unknownSource", { adapter: run.adapter });
}

function KindIcon({ run }: { run: MigrationRun }) {
  return (
    <span className={`mh-kind mh-kind--${isCore(run) ? "core" : "import"}`}>
      <FontAwesomeIcon icon={isCore(run) ? faDatabase : faFileImport} />
    </span>
  );
}

// ── Stats ────────────────────────────────────────────────────────────────────

function Stats({ views, schema, fmt }: {
  views: Array<{ run: MigrationRun; status: EffectiveStatus; dur: string }>;
  schema: SchemaStatus | null;
  fmt: Fmt;
}) {
  const { t } = useTranslation("acp");
  const lastCore = views.find((v) => isCore(v.run));
  const imports = views.filter((v) => !isCore(v.run));
  const running = imports.filter((v) => v.status === "running").length;
  const failed = views.filter((v) => v.status === "failed" || v.status === "stalled").length;
  const partial = views.filter((v) => v.status === "partial").length;

  const items: Array<{ label: string; value: string; sub: string; tone: string; icon: IconDefinition; spin?: boolean }> = [
    lastCore
      ? {
          label: t("migrations.stats.lastDeploy"),
          value: `${fmt.short(startedOf(lastCore.run))}, ${fmt.time(startedOf(lastCore.run))}`,
          sub: `${t(`migrations.status.${lastCore.status}`)} · ${lastCore.dur}`,
          tone: lastCore.status, icon: STATUS_ICON[lastCore.status],
        }
      : { label: t("migrations.stats.lastDeploy"), value: "—", sub: t("migrations.stats.noDeploy"), tone: "muted", icon: faMinus },
    schema
      ? {
          label: t("migrations.stats.schema"),
          value: t("migrations.stats.schemaValue", { count: schema.total }),
          sub: schema.failed.length
            ? t("migrations.stats.schemaFailed", { count: schema.failed.length })
            : schema.pending.length
              ? t("migrations.stats.schemaPending", { count: schema.pending.length })
              : t("migrations.stats.upToDate"),
          tone: schema.failed.length ? "failed" : schema.pending.length ? "partial" : "completed",
          icon: schema.failed.length ? faCircleXmark : schema.pending.length ? faClock : faCheck,
        }
      : { label: t("migrations.stats.schema"), value: "—", sub: t("migrations.stats.schemaUnknown"), tone: "muted", icon: faMinus },
    {
      label: t("migrations.stats.imports"),
      value: t("migrations.stats.runs", { count: imports.length }),
      sub: running ? t("migrations.stats.runningNow", { count: running }) : t("migrations.stats.noneRunning"),
      tone: running ? "running" : "muted", icon: running ? faArrowsRotate : faMinus, spin: running > 0,
    },
    {
      label: t("migrations.stats.attention"),
      value: t("migrations.stats.runs", { count: failed + partial }),
      sub: t("migrations.stats.attentionSub", { failed, partial }),
      tone: failed ? "failed" : partial ? "partial" : "muted",
      icon: failed ? faCircleXmark : partial ? faTriangleExclamation : faCheck,
    },
  ];

  return (
    <div className="mh-card mh-stats">
      {items.map((s) => (
        <div key={s.label} className="mh-stat">
          <div className="mh-stat__label">{s.label}</div>
          <div className="mh-stat__value">{s.value}</div>
          <div className={`mh-stat__sub mh-tone--${s.tone}`}>
            <FontAwesomeIcon icon={s.icon} spin={s.spin} /> {s.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function Detail({ run, status, dur, fmt }: {
  run: MigrationRun; status: EffectiveStatus; dur: string; fmt: Fmt;
}) {
  const { t } = useTranslation("acp");
  const [copied, copy] = useCopy();
  const logRef = useRef<LogHandle>(null);
  const core = isCore(run);
  const started = startedOf(run);
  const output = run.output ?? "";

  const meta: Array<{ label: string; value: string; mono?: boolean }> = [];
  let callout: { tone: "danger" | "warn" | "info"; icon: IconDefinition; title: string; body?: string; mono?: boolean; jump?: number } | null = null;
  const commands: Array<{ key: string; label: string; text: string }> = [];
  let commandsTitle = t("migrations.commands.title");
  let commandsNote: string | null = null;

  if (core) {
    const a = analyseCore(output);
    const result = a.failedName
      ? t("migrations.result.appliedFailed", { count: Math.max(0, a.applied - 1) })
      : a.applied ? t("migrations.result.applied", { count: a.applied })
      : a.nothingToApply ? t("migrations.result.nothing") : "—";
    meta.push(
      { label: t("migrations.meta.started"), value: fmt.time(started, true) },
      { label: t("migrations.meta.duration"), value: dur },
      { label: t("migrations.meta.found"), value: a.found != null ? t("migrations.foundValue", { count: a.found }) : "—" },
      { label: t("migrations.meta.result"), value: result },
    );
    commands.push({ key: "cmd", label: t("migrations.commands.command"), text: "prisma migrate deploy" });
    if (status === "failed" && a.failedName) {
      callout = {
        tone: "danger", icon: faCircleXmark, mono: true,
        title: t("migrations.callout.failedTitle", { name: a.failedName }),
        body: a.errorText ?? undefined, jump: a.errorLine ?? undefined,
      };
      commands.push({ key: "resolve", label: t("migrations.commands.resolve"), text: `prisma migrate resolve --rolled-back ${a.failedName}` });
      commandsTitle = t("migrations.commands.recover");
      commandsNote = t("migrations.commands.recoverNote");
    }
  } else {
    meta.push(
      { label: t("migrations.meta.source"), value: run.sourceInfo ?? "—" },
      { label: t("migrations.meta.adapter"), value: `${packageOf(run)}${run.adapterVer ? ` v${run.adapterVer}` : ""}`, mono: true },
      { label: t("migrations.meta.started"), value: fmt.time(started, true) },
      { label: status === "running" ? t("migrations.meta.elapsed") : t("migrations.meta.duration"), value: dur },
    );
    const issues = run.errors?.length ?? 0;
    if (status === "stalled") {
      const beat = run.progress?.at ? new Date(run.progress.at) : null;
      callout = {
        tone: "warn", icon: faCircleExclamation, title: t("migrations.callout.stalledTitle"),
        body: beat
          ? t("migrations.callout.stalledBody", { time: `${fmt.day(beat)} · ${fmt.time(beat, true)}` })
          : t("migrations.callout.stalledBodyUnknown"),
      };
    } else if (status === "failed") {
      const reason = run.errors?.find((e) => e.entity === "run")?.reason;
      callout = { tone: "danger", icon: faCircleXmark, title: t("migrations.callout.importFailedTitle"), body: reason, mono: true };
    } else if (status === "partial") {
      callout = {
        tone: "warn", icon: faTriangleExclamation,
        title: t("migrations.callout.partialTitle", { count: issues }), body: t("migrations.callout.partialBody"),
      };
    }
    if (run.command) {
      commands.push({ key: "dry", label: t("migrations.commands.dryRun"), text: `${run.command} --dry-run` });
      if (status !== "running") commands.push({ key: "rerun", label: t("migrations.commands.rerun"), text: run.command });
    }
    if (run.reportPath) commands.push({ key: "report", label: t("migrations.commands.report"), text: run.reportPath });
    commandsTitle = t("migrations.commands.titleImport");
    if (run.command && status !== "running") commandsNote = t("migrations.commands.maskedNote");
  }

  // Counts: live progress while it runs, what was imported once it is done.
  let counts: ReactNode = null;
  const entities = run.progress?.entities ?? {};
  if (!core && status === "running" && Object.keys(entities).length) {
    const keys = inLoadOrder(Object.keys(entities));
    const doneN = keys.filter((k) => entities[k]!.done >= entities[k]!.total).length;
    counts = (
      <Section title={t("migrations.counts.progress")} aux={t("migrations.counts.progressAux", { done: doneN, count: keys.length })}>
        <div className="mh-counts">
          {keys.map((k) => {
            const p = entities[k]!;
            const complete = p.done >= p.total;
            const active = run.progress?.current === k;
            return (
              <div key={k} className={`mh-count${complete ? " is-done" : active ? " is-active" : " is-waiting"}`}>
                <div className="mh-count__label">
                  {t(`migrations.entities.${k}`, { defaultValue: k })}
                  {complete && <FontAwesomeIcon icon={faCheck} />}
                </div>
                <div className="mh-count__value">
                  {p.done.toLocaleString()} <span className="mh-count__total">/ {p.total.toLocaleString()}</span>
                </div>
                <div className="mh-bar"><span style={{ width: `${Math.min(100, p.total ? (p.done / p.total) * 100 : 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </Section>
    );
  } else if (!core && run.summary && Object.keys(run.summary).length) {
    const total = Object.values(run.summary).reduce((a, n) => a + n, 0);
    counts = (
      <Section title={t("migrations.counts.imported")} aux={t("migrations.counts.importedAux", { count: total, formatted: total.toLocaleString() })}>
        <div className="mh-counts">
          {inLoadOrder(Object.keys(run.summary)).map((k) => [k, run.summary![k]!] as const).map(([k, n]) => (
            <div key={k} className="mh-count">
              <div className="mh-count__label">{t(`migrations.entities.${entityKey(k)}`, { defaultValue: k })}</div>
              <div className="mh-count__value">{n.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  const issueGroups = groupIssues(run.errors);

  return (
    <section className="mh-card mh-detail">
      <header className="mh-detail__head">
        <KindIcon run={run} />
        <div className="mh-detail__titles">
          <div className={`mh-eyebrow mh-eyebrow--${core ? "core" : "import"}`}>
            {core ? t("migrations.eyebrow.core") : t("migrations.eyebrow.import")}
          </div>
          <h2 className={`mh-detail__title${core ? " is-mono" : ""}`}>{titleOf(run, t)}</h2>
          <div className="mh-detail__date">{fmt.day(started)} · {fmt.time(started)}</div>
        </div>
        <span className={`mh-st mh-st--${status} mh-st--lg`}>
          <FontAwesomeIcon icon={STATUS_ICON[status]} spin={status === "running"} />
          {t(`migrations.status.${status}`)}
          {status === "running" && <span className="mh-st__extra">· {dur}</span>}
        </span>
      </header>

      <div className="mh-meta">
        {meta.map((m) => (
          <div key={m.label}>
            <div className="mh-meta__label">{m.label}</div>
            <div className={`mh-meta__value${m.mono ? " is-mono" : ""}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {callout && (
        <div className={`mh-callout mh-callout--${callout.tone}`}>
          <FontAwesomeIcon icon={callout.icon} className="mh-callout__icon" />
          <div className="mh-callout__main">
            <div className="mh-callout__title">{callout.title}</div>
            {callout.body && <div className={`mh-callout__body${callout.mono ? " is-mono" : ""}`}>{callout.body}</div>}
          </div>
          {callout.jump != null && (
            <button className="mh-callout__jump" onClick={() => logRef.current?.jumpTo(callout!.jump!)}>
              {t("migrations.callout.line", { n: callout.jump })}
            </button>
          )}
        </div>
      )}

      {counts}

      {issueGroups.length > 0 && (
        <Section
          title={t("migrations.issues.title")}
          aux={t(status === "running" ? "migrations.issues.auxRunning" : "migrations.issues.aux", { count: run.errors!.length })}
        >
          <IssueList groups={issueGroups} />
        </Section>
      )}

      {commands.length > 0 && (
        <Section title={commandsTitle}>
          <div className="mh-cmds">
            {commands.map((c) => (
              <div key={c.key} className="mh-cmd">
                <span className="mh-cmd__label">{c.label}</span>
                <code className="mh-cmd__text" title={c.text}>{c.text}</code>
                <button className={`mh-cmd__copy${copied === c.key ? " is-copied" : ""}`} onClick={() => copy(c.key, c.text)}>
                  <FontAwesomeIcon icon={copied === c.key ? faCheck : faCopy} />
                  {copied === c.key ? t("migrations.commands.copied") : t("migrations.commands.copy")}
                </button>
              </div>
            ))}
          </div>
          {commandsNote && <p className="mh-cmds__note">{commandsNote}</p>}
        </Section>
      )}

      <LogViewer ref={logRef} run={run} output={output} live={status === "running"} />
    </section>
  );
}

function Section({ title, aux, children }: { title: string; aux?: string; children: ReactNode }) {
  return (
    <div className="mh-section">
      <div className="mh-section__head">
        <span className="mh-section__title">{title}</span>
        {aux && <span className="mh-section__aux">{aux}</span>}
      </div>
      {children}
    </div>
  );
}

function IssueList({ groups }: { groups: ReturnType<typeof groupIssues> }) {
  const { t } = useTranslation("acp");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="mh-issues">
      {groups.map((g, i) => {
        const isOpen = open[g.entity] ?? i === 0;
        return (
          <div key={g.entity} className="mh-issue">
            <button className="mh-issue__head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.entity]: !isOpen })}>
              <FontAwesomeIcon icon={faChevronRight} className={`mh-issue__chev${isOpen ? " is-open" : ""}`} />
              <span className="mh-issue__entity">{t(`migrations.entities.${g.entity}`, { defaultValue: g.entity })}</span>
              <span className="mh-issue__reason">
                · {g.reasons.length === 1 ? g.reasons[0] : t("migrations.issues.reasons", { count: g.reasons.length })}
              </span>
              <span className="mh-issue__n">{g.items.length}</span>
            </button>
            {isOpen && (
              <ul className="mh-issue__items">
                {g.items.map((it, j) => (
                  <li key={`${it.sourceId}-${j}`}>
                    <span className="mh-issue__id">#{it.sourceId}</span>
                    <span>{it.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Log viewer ───────────────────────────────────────────────────────────────

interface LogHandle { jumpTo(line: number): void }

function LogViewer({ ref, run, output, live }: {
  ref: Ref<LogHandle>; run: MigrationRun; output: string; live: boolean;
}) {
  const { t } = useTranslation("acp");
  const [q, setQ] = useState("");
  const [hideNoise, setHideNoise] = useState(true);
  const [full, setFull] = useState(false);
  const [copied, copy] = useCopy();
  const box = useRef<HTMLDivElement>(null);
  // Follow the tail of a live log — until the admin scrolls up to read.
  const follow = useRef(true);

  const view = useMemo(() => buildLog(output, { hideNoise, q }), [output, hideNoise, q]);

  useImperativeHandle(ref, () => ({
    jumpTo(line: number) {
      // The target may be folded away as noise; show everything, then scroll.
      setHideNoise(false);
      setQ("");
      requestAnimationFrame(() => {
        const el = box.current?.querySelector<HTMLElement>(`[data-ln="${line}"]`);
        if (el && box.current) box.current.scrollTop = Math.max(0, el.offsetTop - 60);
      });
    },
  }), []);

  useEffect(() => {
    const el = box.current;
    if (el && live && follow.current) el.scrollTop = el.scrollHeight;
  }, [view, live]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([output], { type: "text/plain" }));
    const name = isCore(run) ? "deploy" : packageOf(run).replace("@xentium/", "");
    a.download = `migration-${name}-${startedOf(run).toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const meta = q.trim()
    ? t("migrations.log.matches", { count: view.matches })
    : [t("migrations.log.lines", { count: view.total }), view.hidden ? t("migrations.log.hidden", { count: view.hidden }) : null]
        .filter(Boolean).join(" · ");

  return (
    <>
      {full && <div className="mh-log-backdrop" onClick={() => setFull(false)} />}
      <div className={`mh-section mh-log${full ? " is-full" : ""}`}>
        <div className="mh-log__bar">
          <span className="mh-section__title">{t("migrations.log.title")}</span>
          <span className="mh-section__aux">{meta}</span>
          {live && <span className="mh-live"><span className="mh-live__dot" />{t("migrations.log.live")}</span>}
          <span className="mh-log__spacer" />
          <label className="mh-search mh-search--sm">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("migrations.log.find")} aria-label={t("migrations.log.find")} />
          </label>
          <label className="mh-toggle">
            <input type="checkbox" checked={hideNoise} onChange={() => setHideNoise(!hideNoise)} />
            <span className="mh-toggle__track"><span className="mh-toggle__thumb" /></span>
            {t("migrations.log.hideNoise")}
          </label>
          <button className={`mh-icon-btn${copied === "log" ? " is-copied" : ""}`} onClick={() => copy("log", output)}
            title={t("migrations.log.copy")} aria-label={t("migrations.log.copy")}>
            <FontAwesomeIcon icon={copied === "log" ? faCheck : faCopy} />
          </button>
          <button className="mh-icon-btn" onClick={download} title={t("migrations.log.download")} aria-label={t("migrations.log.download")}>
            <FontAwesomeIcon icon={faDownload} />
          </button>
          <button className="mh-icon-btn" onClick={() => setFull(!full)}
            title={full ? t("migrations.log.exitFullscreen") : t("migrations.log.fullscreen")}
            aria-label={full ? t("migrations.log.exitFullscreen") : t("migrations.log.fullscreen")}>
            <FontAwesomeIcon icon={full ? faCompress : faExpand} />
          </button>
        </div>
        <div
          ref={box}
          className="mh-log__box"
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
          }}
        >
          {view.total === 0 ? (
            <div className="mh-log__empty">{t("migrations.noOutput")}</div>
          ) : view.rows.map((row, i) => row.kind === "fold" ? (
            <button key={`f${i}`} className="mh-log__fold" onClick={() => setHideNoise(false)}>
              {t("migrations.log.folded", { count: row.count })}
            </button>
          ) : (
            <div key={row.n} data-ln={row.n} className={`mh-ln mh-ln--${row.tone}${row.hit ? " is-hit" : ""}`}>
              <span className="mh-ln__n">{row.n}</span>
              <span className="mh-ln__t">{row.hit ? <Highlight text={row.text} q={q} /> : row.text || " "}</span>
            </div>
          ))}
          {live && <div className="mh-ln mh-ln--noise"><span className="mh-ln__n" /><span className="mh-ln__t mh-cursor">…</span></div>}
        </div>
      </div>
    </>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  const parts: ReactNode[] = [];
  const low = text.toLowerCase();
  let p = 0;
  for (let j = low.indexOf(needle); j !== -1; j = low.indexOf(needle, p)) {
    if (j > p) parts.push(text.slice(p, j));
    parts.push(<mark key={j}>{text.slice(j, j + needle.length)}</mark>);
    p = j + needle.length;
  }
  if (p < text.length) parts.push(text.slice(p));
  return <>{parts}</>;
}

