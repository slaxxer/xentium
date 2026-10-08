import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faWaveSquare, faBan, faShieldHalved, faClock, faLayerGroup, faMagnifyingGlass,
  faArrowRight, faPlus, faXmark, faCheck, faCircleExclamation, faPuzzlePiece,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { openDialog } from "../../../lib/dialog";
import { useAutosave, sameValue } from "../../../hooks/useAutosave";
import { DraftFailure } from "../../../hooks/useDraft";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle, NumberStepper } from "../../../components/AcpControls";
import "./ModSettingsPage.scss";

/**
 * ACP → Moderation → Mod Settings.
 *
 * Three tabs — how warnings escalate, what a ban may cost, which patterns open a
 * case — autosaving into ONE endpoint that validates every field.
 *
 * ⚠ Only the SECTIONS that changed are sent, and a section nobody touched here
 * follows the server: a tab left open must never write its stale copy back over
 * an edit made elsewhere.
 */

type Action = "notify" | "ban_temporary" | "ban_permanent";
interface Step { warningCount: number; action: Action; banDays?: number; notifyModerators: boolean }
interface Bans { defaultDays: number; minDays: number; maxDays: number; allowOverride: boolean }
type PatternType = "rapid_login_attempts" | "multi_account_suspicion" | "registration_burst" | "ban_evasion_suspicion";
interface PatternView {
  type: PatternType;
  enabled: boolean;
  claimedBy: { id: string; name: string } | null;
  casesLast7d: number;
}
interface ModSettings {
  expiry: { enabled: boolean; days: number };
  ladder: Step[];
  bans: Bans;
  resetAfterBan: boolean;
  patterns: PatternView[];
  detection: { enabled: boolean; intervalMinutes: number | null } | null;
}

interface Draft {
  expiry: ModSettings["expiry"];
  ladder: Step[];
  bans: Bans;
  resetAfterBan: boolean;
  patterns: Record<string, boolean>;
}
type Section = keyof Draft;
const SECTIONS: Section[] = ["expiry", "ladder", "bans", "resetAfterBan", "patterns"];

type Tab = "warnings" | "bans" | "detection";
const TABS: { key: Tab; icon: IconDefinition }[] = [
  { key: "warnings", icon: faWaveSquare },
  { key: "bans", icon: faBan },
  { key: "detection", icon: faShieldHalved },
];

const PATTERN_KEY: Record<PatternType, string> = {
  rapid_login_attempts: "rapid",
  multi_account_suspicion: "multi",
  registration_burst: "burst",
  ban_evasion_suspicion: "evasion",
};

const MAX_STEPS = 10;

function draftOf(s: ModSettings): Draft {
  return {
    expiry: s.expiry,
    ladder: s.ladder,
    bans: s.bans,
    resetAfterBan: s.resetAfterBan,
    patterns: Object.fromEntries(s.patterns.map((p) => [p.type, p.enabled])),
  };
}

/** What the server would store: the ladder sorted, a length only on a temporary ban.
 *  Both sides are compared in this form, or a reordered ladder saves forever. */
function normalise(d: Draft): Draft {
  return {
    ...d,
    ladder: [...d.ladder]
      .sort((a, b) => a.warningCount - b.warningCount)
      .map((s) => (s.action === "ban_temporary" ? s : { warningCount: s.warningCount, action: s.action, notifyModerators: s.notifyModerators })),
  };
}

function ladderProblem(l: Step[]): "duplicate" | "days" | null {
  if (new Set(l.map((s) => s.warningCount)).size !== l.length) return "duplicate";
  if (l.some((s) => s.action === "ban_temporary" && !(s.banDays && s.banDays >= 1))) return "days";
  return null;
}
function bansProblem(b: Bans): "range" | "default" | null {
  if (b.minDays > b.maxDays) return "range";
  if (b.defaultDays < b.minDays || b.defaultDays > b.maxDays) return "default";
  return null;
}

export function ModSettingsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.some((x) => x.key === params.get("tab")) ? params.get("tab") : "warnings") as Tab;

  const { data } = useQuery<ModSettings>({
    queryKey: ["acp-mod-settings"],
    queryFn: () => api.get("/admin/mod-settings"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Draft>) => api.patch<ModSettings>("/admin/mod-settings", patch),
    onSuccess: (res) => qc.setQueryData(["acp-mod-settings"], res),
    // The bar reports the failure; the refetch shows what the server really has.
    onError: () => { void qc.invalidateQueries({ queryKey: ["acp-mod-settings"] }); },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const serverRef = useRef<Draft | null>(null);
  const saved = data ? normalise(draftOf(data)) : undefined;

  // Merge each server snapshot per section: untouched here → follow the server;
  // edited here and not yet saved → keep, autosave is about to send it.
  useEffect(() => {
    if (!saved) return;
    const prev = serverRef.current;
    serverRef.current = saved;
    setDraft((cur) => {
      if (!cur || !prev) return draftOf(data!);
      const next = { ...cur };
      const local = normalise(cur);
      for (const k of SECTIONS) {
        if (sameValue(saved[k], prev[k])) continue;
        if (!sameValue(local[k], prev[k])) continue;
        (next as Record<Section, unknown>)[k] = saved[k];
      }
      return next;
    });
    // `data` is structurally shared by the query client: this runs when the
    // server's values change, not on every refetch.
  }, [data]);

  const ladderIssue = draft ? ladderProblem(draft.ladder) : null;
  const bansIssue = draft ? bansProblem(draft.bans) : null;

  useAutosave({
    value: draft ? normalise(draft) : saved,
    savedValue: saved,
    onSave: (d) => {
      if (!d || !saved) return undefined;
      const patch: Partial<Draft> = {};
      for (const k of SECTIONS) {
        if (sameValue(d[k], saved[k])) continue;
        // An impossible section is held back until it is fixed — the page says why.
        if (k === "ladder" && ladderProblem(d.ladder)) continue;
        if (k === "bans" && bansProblem(d.bans)) continue;
        (patch as Record<Section, unknown>)[k] = d[k];
      }
      // An impossible section was held back above; the page already says why, and the
      // bar says it again rather than reporting a save that did not happen.
      if (ladderProblem(d.ladder)) throw new DraftFailure(t(`modSettings.ladder.issue.${ladderProblem(d.ladder)}`));
      if (bansProblem(d.bans)) throw new DraftFailure(t(`modSettings.bans.issue.${bansProblem(d.bans)}`));
      return Object.keys(patch).length ? save.mutateAsync(patch) : undefined;
    },
    onDiscard: () => { if (data) setDraft(draftOf(data)); },
    label: t("modSettings.title"),
  });

  const set = <K extends Section>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="ms">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("modSettings.sub")}</p>
          <h1 className="pg-title">{t("modSettings.title")}</h1>
          <p className="pg-sub">{t("modSettings.intro")}</p>
        </div>
        <SaveChip saving={save.isPending} />
      </div>

      <div className="acp-tab-bar ms-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            className={`acp-tab${tab === x.key ? " acp-tab--active" : ""}`}
            onClick={() => setParams((p) => { p.set("tab", x.key); return p; }, { replace: true })}>
            <FontAwesomeIcon icon={x.icon} /> {t(`modSettings.tabs.${x.key}`)}
          </button>
        ))}
      </div>

      {!draft || !data ? (
        <div className="set-card ms-loading">{t("sidebar.loading")}</div>
      ) : (
        <div className="set-content">
          {tab === "warnings" && (
            <>
              <Lifetime value={draft.expiry} onChange={(v) => set("expiry", v)} />
              <Ladder steps={draft.ladder} issue={ladderIssue} onChange={(v) => set("ladder", v)} />
            </>
          )}
          {tab === "bans" && (
            <>
              <BanLengths value={draft.bans} issue={bansIssue} onChange={(v) => set("bans", v)} />
              <WhoDecides
                override={draft.bans.allowOverride}
                reset={draft.resetAfterBan}
                onOverride={(v) => set("bans", { ...draft.bans, allowOverride: v })}
                onReset={(v) => set("resetAfterBan", v)}
              />
            </>
          )}
          {tab === "detection" && (
            <Detection
              patterns={data.patterns}
              toggles={draft.patterns}
              detection={data.detection}
              onToggle={(type, on) => set("patterns", { ...draft.patterns, [type]: on })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CardHead({ icon, title, sub, children }: { icon: IconDefinition; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="set-card__head">
      <div className="set-card__icon"><FontAwesomeIcon icon={icon} /></div>
      <div className="set-card__titles">
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      {children}
    </div>
  );
}

// ── Warnings ─────────────────────────────────────────────────────────────────

function Lifetime({ value, onChange }: { value: Draft["expiry"]; onChange: (v: Draft["expiry"]) => void }) {
  const { t } = useTranslation("acp");
  const on = value.enabled;
  return (
    <section className="set-card">
      <CardHead icon={faClock} title={t("modSettings.lifetime.title")} sub={t("modSettings.lifetime.sub")} />
      <div className="set-extra">
        <div className={`ms-banner${on ? " is-on" : ""}`}>
          <div className="ms-banner__ic"><FontAwesomeIcon icon={faWaveSquare} /></div>
          <div className="ms-banner__text">
            <div className="ms-banner__title">{t(on ? "modSettings.lifetime.onTitle" : "modSettings.lifetime.offTitle")}</div>
            <div className="ms-banner__desc">{t(on ? "modSettings.lifetime.onDesc" : "modSettings.lifetime.offDesc")}</div>
          </div>
          <Toggle on={on} onToggle={() => onChange({ ...value, enabled: !on })} />
        </div>
        {on && (
          <div className="ms-after">
            <div>
              <div className="set-row__label">{t("modSettings.lifetime.after")}</div>
              <div className="set-row__desc">{t("modSettings.lifetime.afterDesc")}</div>
            </div>
            <div className="ms-after__ctl">
              <NumberStepper value={value.days} min={1} max={3650} step={5} onChange={(days) => onChange({ ...value, days })} />
              <span className="ms-unit">{t("modSettings.days")}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Ladder({ steps, issue, onChange }: { steps: Step[]; issue: ReturnType<typeof ladderProblem>; onChange: (v: Step[]) => void }) {
  const { t } = useTranslation("acp");
  const sorted = [...steps].sort((a, b) => a.warningCount - b.warningCount);
  const last = sorted[sorted.length - 1];

  const what = (s: Step) => s.action === "ban_permanent" ? t("modSettings.ladder.whatPerm")
    : s.action === "ban_temporary" ? t("modSettings.ladder.whatTemp", { count: s.banDays ?? 0 })
    : t("modSettings.ladder.whatNotify");

  const update = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function remove(i: number) {
    const s = steps[i]!;
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("modSettings.ladder.removeTitle"),
      body: `${t("modSettings.ladder.removeBody", { count: s.warningCount })} ${t("modSettings.ladder.removeNote")}`,
      confirmText: t("modSettings.ladder.removeConfirm"),
      cancelText: t("modSettings.ladder.removeCancel"),
    });
    if (ok) onChange(steps.filter((_, j) => j !== i));
  }

  function add() {
    const top = sorted.length ? last!.warningCount : 0;
    onChange([...steps, { warningCount: top + 2, action: "notify", notifyModerators: true }]);
  }

  const dupes = new Set(steps.map((s) => s.warningCount).filter((n, i, a) => a.indexOf(n) !== i));

  return (
    <section className="set-card">
      <CardHead icon={faLayerGroup} title={t("modSettings.ladder.title")} sub={t("modSettings.ladder.sub")}>
        <span className="set-card__beta">{t("modSettings.ladder.count", { count: steps.length })}</span>
      </CardHead>

      <div className="ms-rail-wrap">
        <div className="ms-rail">
          {sorted.length === 0 ? (
            <span className="ms-rail__empty">{t("modSettings.ladder.railEmpty")}</span>
          ) : (
            <>
              {sorted.map((s, i) => (
                <div key={i} className="ms-rail__step">
                  <div>
                    <div className="ms-rail__when">{t("modSettings.ladder.railWhen", { count: s.warningCount })}</div>
                    <div className="ms-rail__what">{what(s)}</div>
                  </div>
                  <FontAwesomeIcon icon={faArrowRight} className="ms-rail__arrow" />
                </div>
              ))}
              <span className="ms-rail__end">
                {t(last!.action === "ban_permanent" ? "modSettings.ladder.endPerm" : "modSettings.ladder.endOpen")}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="ms-steps">
        {steps.map((s, i) => (
          <div key={i} className={`ms-step${i === steps.length - 1 ? " is-last" : ""}`}>
            <div className="ms-step__num">{s.warningCount}</div>
            <div className={`ms-step__box${dupes.has(s.warningCount) ? " is-bad" : ""}`}>
              <div className="ms-step__row">
                <span className="ms-word">{t("modSettings.ladder.after")}</span>
                <input type="number" className="inp inp--sm ms-num" min={1} max={100} value={s.warningCount}
                  aria-label={t("modSettings.ladder.afterAria")}
                  onChange={(e) => update(i, { warningCount: Math.max(1, Number(e.target.value) || 1) })} />
                <span className="ms-word">{t("modSettings.ladder.warnings")}</span>
                <FontAwesomeIcon icon={faArrowRight} className="ms-step__arrow" />
                <select className="inp inp--sm ms-select" value={s.action} aria-label={t("modSettings.ladder.actionAria")}
                  onChange={(e) => {
                    const action = e.target.value as Action;
                    update(i, {
                      action,
                      ...(action === "ban_temporary" && !s.banDays ? { banDays: 7 } : {}),
                      ...(action === "notify" ? { notifyModerators: true } : {}),
                    });
                  }}>
                  <option value="notify">{t("modSettings.ladder.actNotify")}</option>
                  <option value="ban_temporary">{t("modSettings.ladder.actTemp")}</option>
                  <option value="ban_permanent">{t("modSettings.ladder.actPerm")}</option>
                </select>
                {s.action === "ban_temporary" && (
                  <>
                    <span className="ms-word">{t("modSettings.ladder.for")}</span>
                    <input type="number" className="inp inp--sm ms-num" min={1} max={3650} value={s.banDays ?? 7}
                      aria-label={t("modSettings.ladder.daysAria")}
                      onChange={(e) => update(i, { banDays: Math.max(1, Number(e.target.value) || 1) })} />
                    <span className="ms-word">{t("modSettings.days")}</span>
                  </>
                )}
                <button type="button" className="mnt-del ms-step__del" aria-label={t("modSettings.ladder.removeAria")} onClick={() => remove(i)}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <div className="ms-step__foot">
                <span className="ms-step__summary">
                  {t("modSettings.ladder.summary", { count: s.warningCount, what: what(s) })}
                  {/* A "notify only" step IS the notice — it has no switch to turn it off. */}
                  {s.action !== "notify" && <>{" · "}{t(s.notifyModerators ? "modSettings.ladder.told" : "modSettings.ladder.silent")}</>}
                </span>
                {s.action !== "notify" && (
                  <>
                    <span className="ms-step__notify">{t("modSettings.ladder.notify")}</span>
                    <Toggle on={s.notifyModerators} onToggle={() => update(i, { notifyModerators: !s.notifyModerators })} />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {issue && (
          <div className="ms-alert" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <div>
              <div className="ms-alert__title">{t(`modSettings.ladder.issue.${issue}`)}</div>
              <div className="ms-alert__desc">{t("modSettings.notSaved")}</div>
            </div>
          </div>
        )}

        {steps.length < MAX_STEPS && (
          <button type="button" className="mnt-add ms-add" onClick={add}>
            <FontAwesomeIcon icon={faPlus} /> {t("modSettings.ladder.add")}
          </button>
        )}
      </div>
    </section>
  );
}

// ── Bans ─────────────────────────────────────────────────────────────────────

function BanLengths({ value, issue, onChange }: { value: Bans; issue: ReturnType<typeof bansProblem>; onChange: (v: Bans) => void }) {
  const { t } = useTranslation("acp");
  const field = (k: "defaultDays" | "minDays" | "maxDays", bad: boolean) => (
    <div className="ms-field">
      <label className="ms-field__label" htmlFor={`ms-${k}`}>{t(`modSettings.bans.${k}`)}</label>
      <input id={`ms-${k}`} type="number" min={1} max={3650} className={`inp${bad ? " is-bad" : ""}`} value={value[k]}
        onChange={(e) => onChange({ ...value, [k]: Math.max(1, Number(e.target.value) || 1) })} />
      <div className="ms-field__hint">{t(`modSettings.bans.${k}Hint`)}</div>
    </div>
  );
  return (
    <section className="set-card">
      <CardHead icon={faClock} title={t("modSettings.bans.title")} sub={t("modSettings.bans.sub")} />
      <div className="set-extra">
        <div className="ms-fields">
          {field("defaultDays", issue === "default")}
          {field("minDays", issue === "range")}
          {field("maxDays", issue === "range")}
        </div>
        {issue ? (
          <div className="ms-alert" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <div>
              <div className="ms-alert__title">{t(`modSettings.bans.issue.${issue}`)}</div>
              <div className="ms-alert__desc">{t("modSettings.bans.issueDesc")}</div>
            </div>
          </div>
        ) : (
          <div className="ms-ok">
            <FontAwesomeIcon icon={faCheck} />
            <span>{t("modSettings.bans.summary", { min: value.minDays, max: value.maxDays, def: value.defaultDays })}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function WhoDecides({ override, reset, onOverride, onReset }: {
  override: boolean; reset: boolean; onOverride: (v: boolean) => void; onReset: (v: boolean) => void;
}) {
  const { t } = useTranslation("acp");

  async function toggleReset() {
    if (reset) return onReset(false);
    const ok = await openDialog({
      kind: "confirm", icon: "question",
      title: t("modSettings.who.resetConfirmTitle"),
      body: `${t("modSettings.who.resetConfirmBody")} ${t("modSettings.who.resetConfirmNote")}`,
      confirmText: t("modSettings.who.resetConfirm"),
    });
    if (ok) onReset(true);
  }

  return (
    <section className="set-card">
      <CardHead icon={faShieldHalved} title={t("modSettings.who.title")} sub={t("modSettings.who.sub")} />
      <div className="set-rows">
        <div className="set-row ms-row">
          <div>
            <div className="set-row__label">{t("modSettings.who.override")}</div>
            <div className="set-row__desc">{t("modSettings.who.overrideDesc")}</div>
          </div>
          <div className="set-row__control"><Toggle on={override} onToggle={() => onOverride(!override)} /></div>
        </div>
        <div className="set-row ms-row">
          <div>
            <div className="set-row__label">{t("modSettings.who.reset")}</div>
            <div className="set-row__desc">{t("modSettings.who.resetDesc")}</div>
          </div>
          <div className="set-row__control"><Toggle on={reset} onToggle={toggleReset} /></div>
        </div>
      </div>
    </section>
  );
}

// ── Detection ────────────────────────────────────────────────────────────────

function Detection({ patterns, toggles, detection, onToggle }: {
  patterns: PatternView[];
  toggles: Record<string, boolean>;
  detection: ModSettings["detection"];
  onToggle: (type: PatternType, on: boolean) => void;
}) {
  const { t } = useTranslation("acp");
  const paused = detection && !detection.enabled;
  const sub = paused ? t("modSettings.detection.paused")
    : t("modSettings.detection.sub", { count: detection?.intervalMinutes ?? 30 });

  return (
    <section className="set-card">
      <CardHead icon={faMagnifyingGlass} title={t("modSettings.detection.title")} sub={sub}>
        <Link to="/admin/cases" className="ms-link-btn">
          {t("modSettings.detection.cases")} <FontAwesomeIcon icon={faArrowRight} />
        </Link>
      </CardHead>
      <div className="set-extra ms-patterns">
        {patterns.map((p) => {
          const key = PATTERN_KEY[p.type];
          const on = toggles[p.type] !== false;
          return (
            <div key={p.type} className="ms-pattern">
              <div className="ms-pattern__head">
                <div className="ms-pattern__text">
                  <div className="ms-pattern__title">{t(`modSettings.detection.${key}.title`)}</div>
                  <div className="ms-pattern__desc">{t(`modSettings.detection.${key}.desc`)}</div>
                </div>
                {p.claimedBy ? (
                  <span className="ms-claimed"><FontAwesomeIcon icon={faPuzzlePiece} /> {t("modSettings.detection.claimed", { name: p.claimedBy.name })}</span>
                ) : (
                  <Toggle on={on} onToggle={() => onToggle(p.type, !on)} />
                )}
              </div>
              {(on || p.claimedBy) && (
                <div className="ms-pattern__foot">
                  {!p.claimedBy && <span className="ms-pattern__rule">{t(`modSettings.detection.${key}.rule`)}</span>}
                  {p.casesLast7d > 0 ? (
                    <Link to={`/admin/cases?type=${p.type}&status=all`} className="ms-pattern__cases">
                      <span className="ms-pill">{t("modSettings.detection.casesWeek", { count: p.casesLast7d })}</span>
                      <span className="ms-pattern__see">{t("modSettings.detection.see")}</span>
                    </Link>
                  ) : (
                    <span className="ms-pattern__none">{t("modSettings.detection.noneWeek")}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
