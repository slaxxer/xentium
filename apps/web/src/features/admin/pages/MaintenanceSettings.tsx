import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPowerOff, faSquareCheck, faPlus, faXmark,
  faLink, faHashtag, faAt, faCodeBranch, faComments, faPaperPlane,
  faPlay, faSignal, faEnvelope,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Toggle, TextField, NumberStepper } from "../../../components/AcpControls";
import type {
  MaintenanceBackground, MaintenanceLink, MaintenanceLinkIcon,
  MaintenanceProgressMode, MaintenanceService, MaintenanceServiceStatus,
} from "../../maintenance/useMaintenance";

/**
 * ACP → System → Settings → Maintenance mode.
 *
 * The maintenance settings stopped fitting the generic label/description/control
 * row the moment they grew editors (steps, services, links): this section owns
 * its own body, grouped under headings, while still writing into the Settings
 * page's one draft — so it autosaves with everything else and reports into the
 * page's single SaveChip. Shell, rows and controls are core's own, never
 * look-alikes.
 */

const PROGRESS_MODES: MaintenanceProgressMode[] = ["steps", "bar", "hidden"];
const BACKGROUNDS: MaintenanceBackground[] = ["aurora", "solid"];
const SERVICE_STATES: MaintenanceServiceStatus[] = ["offline", "degraded", "operational"];

/** Icon keys the maintenance screen can draw (it bundles these solid icons; a
 *  brands pack is not worth the weight, so brand marks are stood in for). */
const LINK_ICONS: Record<MaintenanceLinkIcon, IconDefinition> = {
  link:     faLink,
  discord:  faHashtag,
  x:        faAt,
  github:   faCodeBranch,
  mastodon: faComments,
  telegram: faPaperPlane,
  youtube:  faPlay,
  status:   faSignal,
  email:    faEnvelope,
};
const LINK_ICON_KEYS = Object.keys(LINK_ICONS) as MaintenanceLinkIcon[];

const MAX_STEPS = 12;
const MAX_SERVICES = 12;
const MAX_LINKS = 8;

/** The swatch a background button previews — the same recipe the public screen
 *  paints, so the picker cannot drift from what it is choosing. */
const BG_SWATCH: Record<MaintenanceBackground, string> = {
  aurora:
    "radial-gradient(70% 70% at 20% 10%, color-mix(in srgb, var(--c-accent) 75%, transparent), transparent 70%)," +
    "radial-gradient(60% 60% at 85% 90%, color-mix(in srgb, var(--c-accent2) 50%, transparent), transparent 70%)," +
    "var(--c-bg)",
  solid: "linear-gradient(180deg, var(--c-bg-hover), var(--c-bg))",
};

interface Props {
  draft: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  groups: { key: string; name: string }[];
}

export function MaintenanceSettings({ draft, set, groups }: Props) {
  const { t } = useTranslation("acp");
  const tr = (k: string) => t(`settings.maintenance.${k}`);

  const str  = (k: string, d = "") => (typeof draft[k] === "string" ? (draft[k] as string) : d);
  const bool = (k: string, d = true) => (draft[k] === undefined ? d : draft[k] !== false);

  const enabled     = draft["maintenance.enabled"] === true;
  const mode        = (PROGRESS_MODES.includes(draft["maintenance.progress_mode"] as MaintenanceProgressMode)
    ? draft["maintenance.progress_mode"] : "bar") as MaintenanceProgressMode;
  const background  = (BACKGROUNDS.includes(draft["maintenance.background"] as MaintenanceBackground)
    ? draft["maintenance.background"] : "aurora") as MaintenanceBackground;
  const steps       = Array.isArray(draft["maintenance.steps"]) ? draft["maintenance.steps"] as string[] : [];
  const currentStep = Number(draft["maintenance.current_step"]) || 1;
  const services    = Array.isArray(draft["maintenance.services"]) ? draft["maintenance.services"] as MaintenanceService[] : [];
  const links       = Array.isArray(draft["maintenance.links"]) ? draft["maintenance.links"] as MaintenanceLink[] : [];

  const selectedGroups: string[] = Array.isArray(draft["maintenance.allowed_groups"])
    ? draft["maintenance.allowed_groups"] as string[]
    : ["admin"];

  const eta = str("maintenance.eta");
  const etaLocal = (() => {
    if (!eta) return "";
    const d = new Date(eta);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  function toggleGroup(key: string) {
    set("maintenance.allowed_groups",
      selectedGroups.includes(key) ? selectedGroups.filter((k) => k !== key) : [...selectedGroups, key]);
  }

  return (
    <div className="set-rows mnt">
      {/* Master switch — the one control that changes what visitors see, so it
          leads the card rather than sitting in the row list. */}
      <div className={`mnt-banner${enabled ? " is-on" : ""}`}>
        <span className="mnt-banner__icon"><FontAwesomeIcon icon={faPowerOff} /></span>
        <div>
          <div className="mnt-banner__title">{tr("master.label")}</div>
          <div className="mnt-banner__desc">{tr("master.desc")}</div>
        </div>
        <Toggle on={enabled} onToggle={() => set("maintenance.enabled", !enabled)} />
      </div>

      <Group title={tr("groups.access")} first />
      <Row label={tr("allowedGroups.label")} desc={tr("allowedGroups.desc")}>
        <div className="mnt-chips">
          {groups.map((g) => {
            const isAdmin = g.key === "admin"; // admins always bypass — locked on
            const on = isAdmin || selectedGroups.includes(g.key);
            return (
              <button
                key={g.key}
                type="button"
                className={`mnt-chip${on ? " is-on" : ""}`}
                onClick={() => !isAdmin && toggleGroup(g.key)}
                disabled={isAdmin}
                title={isAdmin ? tr("allowedGroups.adminLocked") : undefined}
              >
                {on && <FontAwesomeIcon icon={faSquareCheck} />}
                {g.name}
              </button>
            );
          })}
        </div>
      </Row>

      <Group title={tr("groups.copy")} />
      <Row label={tr("headline.label")} desc={tr("headline.desc")}>
        <TextField
          value={str("maintenance.title")}
          onChange={(v) => set("maintenance.title", v)}
          placeholder={tr("headline.placeholder")}
        />
      </Row>
      <Row label={tr("reason.label")} desc={tr("reason.desc")} align="start">
        <textarea
          className="inp mnt-textarea"
          rows={3}
          value={str("maintenance.message")}
          placeholder={tr("reason.placeholder")}
          onChange={(e) => set("maintenance.message", e.target.value)}
        />
      </Row>

      <Group title={tr("groups.progress")} />
      <Row label={tr("mode.label")} desc={tr("mode.desc")}>
        <div className="mnt-seg">
          {PROGRESS_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "is-on" : ""}
              onClick={() => set("maintenance.progress_mode", m)}
            >
              {tr(`mode.options.${m}`)}
            </button>
          ))}
        </div>
      </Row>

      {mode === "steps" && (
        <Row label={tr("steps.label")} desc={tr("steps.desc")} align="start">
          <div className="mnt-list">
            {steps.map((name, i) => (
              <div key={i} className="mnt-list__row">
                <button
                  type="button"
                  className={`mnt-mark${currentStep === i + 1 ? " is-on" : ""}`}
                  title={tr("steps.markCurrent")}
                  aria-label={tr("steps.markCurrent")}
                  aria-pressed={currentStep === i + 1}
                  onClick={() => set("maintenance.current_step", i + 1)}
                />
                <input
                  className="inp inp--sm"
                  value={name}
                  onChange={(e) => set("maintenance.steps", steps.map((s, j) => (j === i ? e.target.value : s)))}
                />
                <RemoveButton
                  label={tr("steps.remove")}
                  onClick={() => {
                    const next = steps.filter((_, j) => j !== i);
                    set("maintenance.steps", next);
                    // Keep the marker on a step that still exists.
                    if (currentStep > next.length) set("maintenance.current_step", Math.max(1, next.length));
                  }}
                />
              </div>
            ))}
            {steps.length < MAX_STEPS && (
              <AddButton label={tr("steps.add")} onClick={() => set("maintenance.steps", [...steps, tr("steps.new")])} />
            )}
          </div>
        </Row>
      )}

      {mode === "bar" && (
        <Row label={tr("bar.label")} desc={tr("bar.desc")}>
          <div className="mnt-bar-row">
            <TextField
              value={str("maintenance.progress_label")}
              onChange={(v) => set("maintenance.progress_label", v)}
              placeholder={tr("bar.placeholder")}
            />
            <NumberStepper
              value={Number(draft["maintenance.progress_percent"] ?? 0)}
              onChange={(v) => set("maintenance.progress_percent", v)}
              min={0}
              max={100}
              step={5}
            />
          </div>
        </Row>
      )}

      <Group title={tr("groups.timing")} />
      <Row label={tr("eta.label")} desc={tr("eta.desc")}>
        <input
          type="datetime-local"
          className="inp"
          value={etaLocal}
          onChange={(e) => set("maintenance.eta", e.target.value ? new Date(e.target.value).toISOString() : "")}
        />
      </Row>
      <Row label={tr("countdown.label")} desc={tr("countdown.desc")}>
        <Toggle on={bool("maintenance.countdown")} onToggle={() => set("maintenance.countdown", !bool("maintenance.countdown"))} />
      </Row>
      <Row label={tr("autoRefresh.label")} desc={tr("autoRefresh.desc")}>
        <Toggle on={bool("maintenance.auto_refresh")} onToggle={() => set("maintenance.auto_refresh", !bool("maintenance.auto_refresh"))} />
      </Row>

      <Group title={tr("groups.look")} />
      <Row label={tr("background.label")} desc={tr("background.desc")}>
        <div className="mnt-bgs">
          {BACKGROUNDS.map((b) => (
            <button
              key={b}
              type="button"
              className={`mnt-bg${background === b ? " is-on" : ""}`}
              onClick={() => set("maintenance.background", b)}
              aria-pressed={background === b}
            >
              <span className="mnt-bg__swatch" style={{ background: BG_SWATCH[b] }} />
              <span className="mnt-bg__label">{tr(`background.options.${b}`)}</span>
            </button>
          ))}
        </div>
      </Row>

      <Group title={tr("groups.extras")} />
      <Row label={tr("services.label")} desc={tr("services.desc")} align="start">
        <div className="mnt-list">
          {services.map((svc, i) => {
            const nextState = SERVICE_STATES[(SERVICE_STATES.indexOf(svc.status) + 1) % SERVICE_STATES.length]!;
            return (
              <div key={i} className="mnt-list__row">
                <input
                  className="inp inp--sm"
                  value={svc.name}
                  onChange={(e) => set("maintenance.services", services.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)))}
                />
                <button
                  type="button"
                  className={`mnt-state is-${svc.status}`}
                  title={tr("services.cycle")}
                  onClick={() => set("maintenance.services", services.map((s, j) => (j === i ? { ...s, status: nextState } : s)))}
                >
                  <i />{tr(`services.states.${svc.status}`)}
                </button>
                <RemoveButton
                  label={tr("services.remove")}
                  onClick={() => set("maintenance.services", services.filter((_, j) => j !== i))}
                />
              </div>
            );
          })}
          {services.length < MAX_SERVICES && (
            <AddButton
              label={tr("services.add")}
              onClick={() => set("maintenance.services", [...services, { name: tr("services.new"), status: "operational" }])}
            />
          )}
        </div>
      </Row>

      <Row label={tr("links.label")} desc={tr("links.desc")} align="start">
        <div className="mnt-list">
          {links.map((l, i) => {
            const nextIcon = LINK_ICON_KEYS[(LINK_ICON_KEYS.indexOf(l.icon) + 1) % LINK_ICON_KEYS.length]!;
            return (
              <div key={i} className="mnt-list__row">
                <button
                  type="button"
                  className="mnt-linkicon"
                  title={tr("links.cycleIcon")}
                  aria-label={tr("links.cycleIcon")}
                  onClick={() => set("maintenance.links", links.map((x, j) => (j === i ? { ...x, icon: nextIcon } : x)))}
                >
                  <FontAwesomeIcon icon={LINK_ICONS[l.icon] ?? faLink} />
                </button>
                <input
                  className="inp inp--sm"
                  value={l.url}
                  placeholder="https://"
                  onChange={(e) => set("maintenance.links", links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <RemoveButton
                  label={tr("links.remove")}
                  onClick={() => set("maintenance.links", links.filter((_, j) => j !== i))}
                />
              </div>
            );
          })}
          {links.length < MAX_LINKS && (
            <AddButton
              label={tr("links.add")}
              onClick={() => set("maintenance.links", [...links, { icon: "link", label: "", url: "https://" }])}
            />
          )}
        </div>
      </Row>

      <Row label={tr("staffLink.label")} desc={tr("staffLink.desc")}>
        <Toggle on={bool("maintenance.staff_link")} onToggle={() => set("maintenance.staff_link", !bool("maintenance.staff_link"))} />
      </Row>
    </div>
  );
}

/** Card-head pill: is the site actually closed right now? */
export function MaintenanceStatusPill({ on }: { on: boolean }) {
  const { t } = useTranslation("acp");
  return (
    <span className={`mnt-pill${on ? " is-on" : ""}`}>
      <i />{t(`settings.maintenance.pill.${on ? "offline" : "live"}`)}
    </span>
  );
}

// ── Row primitives — core's `.set-row` shell, with a heading between groups ──

function Group({ title, first }: { title: string; first?: boolean }) {
  return <div className={`mnt-group${first ? " is-first" : ""}`}>{title}</div>;
}

function Row({
  label, desc, align = "center", children,
}: {
  label: string; desc: string; align?: "center" | "start"; children: React.ReactNode;
}) {
  return (
    <div className={`set-row${align === "start" ? " set-row--start" : ""}`}>
      <div>
        <div className="set-row__label">{label}</div>
        <div className="set-row__desc">{desc}</div>
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mnt-add" onClick={onClick}>
      <FontAwesomeIcon icon={faPlus} />{label}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mnt-del" onClick={onClick} title={label} aria-label={label}>
      <FontAwesomeIcon icon={faXmark} />
    </button>
  );
}
