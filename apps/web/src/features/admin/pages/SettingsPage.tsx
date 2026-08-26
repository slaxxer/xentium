import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash, faCopy, faSquareCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave, useAnySaving, sameValue } from "../../../hooks/useAutosave";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { AcpIcon, type AcpIconName } from "./acpIcons";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle, TextField, NumberStepper } from "../../../components/AcpControls";
import { MaintenanceSettings, MaintenanceStatusPill } from "./MaintenanceSettings";
import { ErrorBoundary } from "../../errors/ErrorBoundary";
import { slotRegistry } from "../../../plugins/slotRegistry";

// Core landing values → i18n label keys; plugin destinations use their own label.
const CORE_LANDING_I18N: Record<string, string> = {
  home: "settings.landing.home",
  "/articles": "settings.landing.articles",
  "/members": "settings.landing.members",
};
import "./acpSystem.scss";

// ── i18n locales bundled in v1 (§60.6) ───────────────────────────────────────
const LOCALES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch (German)" },
  { value: "es", label: "Español (Spanish)" },
  { value: "fr", label: "Français (French)" },
  { value: "pt", label: "Português (Portuguese)" },
];

// ── Common timezones ──────────────────────────────────────────────────────────
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

interface Setting { key: string; value: unknown }

// Map flat settings array → lookup by key
function parseSettings(settings: Setting[]): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const s of settings) m[s.key] = s.value;
  return m;
}

// ── Redesigned form controls (Hearth) ─────────────────────────────────────────

function Select({
  value, onChange, options,
}: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className={`sel${open ? " is-open" : ""}`} ref={ref}>
      <button type="button" className="sel__btn" onClick={() => setOpen((o) => !o)}>
        {current ? current.label : value}
      </button>
      <AcpIcon name="chevron" size={16} className="sel__chev" />
      {open && (
        <div className="sel__menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`sel__opt${o.value === value ? " is-sel" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.value === value && <AcpIcon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section schema ────────────────────────────────────────────────────────────

// `i18nKey` → settings.fields.<i18nKey>.{label,desc}; `placeholderKey` →
// settings.placeholders.<placeholderKey>; `optionsKey`/`values` →
// settings.options.<optionsKey>.<value>. `key` is the setting storage key.
interface SectionField {
  i18nKey: string;
  key: string;
  type: "text" | "number" | "toggle" | "select" | "language" | "timezone" | "landing" | "group" | "groups" | "datetime";
  placeholderKey?: string;
  optionsKey?: string;
  values?: string[];
  min?: number;
  max?: number;
  step?: number;
}

/** A section is either a list of generic rows (`fields`) or a body of its own
 *  (`custom`) — the latter still declares its `keys` so the page-wide autosave
 *  covers it exactly like every other section. */
interface Section {
  id: string;
  icon: AcpIconName;
  fields?: SectionField[];
  custom?: "maintenance";
  keys?: string[];
}

const SECTIONS: Section[] = [
  {
    id: "general", icon: "sliders",
    fields: [
      { i18nKey: "siteName",        key: "site.name",        type: "text",     placeholderKey: "siteName" },
      { i18nKey: "siteUrl",         key: "site.url",         type: "text",     placeholderKey: "siteUrl" },
      { i18nKey: "siteDescription", key: "site.description", type: "text",     placeholderKey: "siteDescription" },
      { i18nKey: "defaultLanguage", key: "site.locale",      type: "language" },
      { i18nKey: "timezone",        key: "site.timezone",    type: "timezone" },
    ],
  },
  {
    id: "features", icon: "layers",
    fields: [
      { i18nKey: "featuresArticles", key: "features.articles.enabled", type: "toggle" },
      { i18nKey: "featuresHome",     key: "features.home.enabled",     type: "toggle" },
      { i18nKey: "featuresMembers",  key: "features.members.enabled",  type: "toggle" },
      { i18nKey: "landing",          key: "site.landing",              type: "landing" },
    ],
  },
  {
    id: "maintenance", icon: "cog", custom: "maintenance",
    keys: [
      "maintenance.enabled",
      "maintenance.allowed_groups",
      "maintenance.title",
      "maintenance.message",
      "maintenance.progress_mode",
      "maintenance.progress_label",
      "maintenance.progress_percent",
      "maintenance.steps",
      "maintenance.current_step",
      "maintenance.eta",
      "maintenance.countdown",
      "maintenance.auto_refresh",
      "maintenance.background",
      "maintenance.services",
      "maintenance.links",
      "maintenance.staff_link",
    ],
  },
  {
    id: "login", icon: "shield",
    fields: [
      { i18nKey: "loginMethod",       key: "auth.login_method",              type: "select", optionsKey: "loginMethod", values: ["email", "username", "either"] },
      { i18nKey: "lockoutEnabled",    key: "auth.lockout_enabled",           type: "toggle" },
      { i18nKey: "lockoutMaxAttempts",key: "auth.lockout_max_attempts",      type: "number", min: 1, max: 20, step: 1 },
      { i18nKey: "lockoutDuration",   key: "auth.lockout_duration_minutes",  type: "number", min: 1, max: 1440, step: 1 },
    ],
  },
  {
    id: "registration", icon: "userPlus",
    fields: [
      { i18nKey: "registrationMode", key: "auth.registration_mode", type: "select", optionsKey: "regMode", values: ["open", "invite", "closed"] },
      { i18nKey: "emailVerification", key: "auth.require_email_verification", type: "toggle" },
      { i18nKey: "defaultGroup", key: "auth.default_group", type: "select", optionsKey: "defaultGroup", values: ["member", "moderator"] },
      { i18nKey: "collectName",  key: "registration.collect_name",  type: "toggle" },
      { i18nKey: "nameRequired", key: "registration.name_required", type: "toggle" },
      { i18nKey: "showPreviousUsernames", key: "profile.show_previous_usernames", type: "toggle" },
      { i18nKey: "previousUsernameDays",  key: "profile.previous_username_days",  type: "number", min: 0, max: 3650, step: 1 },
    ],
  },
  {
    id: "content", icon: "file",
    fields: [
      { i18nKey: "allowComments",   key: "articles.allow_comments",           type: "toggle" },
      { i18nKey: "approveComments", key: "articles.require_comment_approval", type: "toggle" },
      { i18nKey: "perPage",         key: "articles.per_page",                 type: "number", min: 5, max: 100, step: 5 },
    ],
  },
  {
    id: "homefeed", icon: "home",
    fields: [
      { i18nKey: "showHot", key: "home.hot_threads_enabled", type: "toggle" },
      { i18nKey: "hotRank", key: "home.hot_threads_metric",  type: "select", optionsKey: "hotRank", values: ["replies", "recent"] },
    ],
  },
  {
    id: "members", icon: "users",
    fields: [
      { i18nKey: "hofRank", key: "members.hall_of_fame_metric", type: "select", optionsKey: "hofRank", values: ["likes", "posts", "threads", "followers"] },
    ],
  },
  // Outbound mail lives on its own page (ACP → System → Email), where the
  // server configuration sits alongside the templates it renders.
];

// Default values used until the API responds
const DEFAULTS: Record<string, unknown> = {
  "beta.enabled":                       false,
  "beta.admin_key":                     "",
  "beta.public_routes":                 [],
  "site.name":                          "My Nodevo Site",
  "site.url":                           "",
  "site.description":                   "",
  "site.locale":                        "en",
  "site.timezone":                      "UTC",
  "features.articles.enabled":          true,
  "features.home.enabled":              true,
  "features.members.enabled":           true,
  "site.landing":                       "home",
  "maintenance.enabled":                false,
  "maintenance.allowed_groups":         ["admin"],
  "maintenance.title":                  "Down for a quick tune-up.",
  "maintenance.message":                "We're making the community better. We'll be back shortly.",
  // "bar" keeps installs that predate the progress modes exactly as they were:
  // a bar that only appears once the percentage is above zero.
  "maintenance.progress_mode":          "bar",
  "maintenance.progress_label":         "In progress",
  "maintenance.progress_percent":       0,
  "maintenance.steps":                  [],
  "maintenance.current_step":           1,
  "maintenance.eta":                    "",
  "maintenance.countdown":              true,
  "maintenance.auto_refresh":           true,
  "maintenance.background":             "aurora",
  "maintenance.services":               [],
  "maintenance.links":                  [],
  "maintenance.staff_link":             true,
  "auth.registration_mode":             "open",
  "auth.allow_registration":            true,
  "auth.require_email_verification":    true,
  "auth.default_group":                 "member",
  "auth.login_method":                  "email",
  "auth.lockout_enabled":               true,
  "auth.lockout_max_attempts":          5,
  "auth.lockout_duration_minutes":      10,
  "registration.collect_name":          false,
  "registration.name_required":         false,
  "profile.show_previous_usernames":    true,
  "profile.previous_username_days":     90,
  "articles.allow_comments":            true,
  "articles.require_comment_approval":  false,
  "articles.per_page":                  10,
  "home.hot_threads_enabled":           true,
  "home.hot_threads_metric":            "replies",
  "members.hall_of_fame_metric":        "likes",
};

export function SettingsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data: settings = [] } = useQuery<Setting[]>({
    queryKey: ["acp-settings"],
    queryFn: () => api.get("/admin/settings"),
  });

  // Drives the landing dropdown — only destinations that currently exist
  // (enabled core sections + active plugin nav items, e.g. Forum).
  const { data: siteConfig } = useSiteConfig();

  // All user groups — drives the maintenance "allowed group" select.
  const { data: allGroups = [] } = useQuery<{ name: string; key: string }[]>({
    queryKey: ["legend-groups"],
    queryFn: () => api.get("/members/groups"),
    staleTime: 300_000,
  });

  // Local draft state seeded from API
  const [draft, setDraft] = useState<Record<string, unknown>>(DEFAULTS);

  /**
   * The last server snapshot this page merged.
   *
   * It is what lets a refetch tell "somebody else changed this key" apart from
   * "I changed it and it has not saved yet" — the two look identical if you
   * only compare the draft against the incoming values.
   */
  const serverRef = useRef<Record<string, unknown> | null>(null);

  /**
   * Merge each new server snapshot into the draft, per key.
   *
   * This used to re-seed on `[settings.length]`, which meant it re-ran only if
   * the NUMBER of settings rows changed — so a tab that had been open while
   * somebody edited the same settings elsewhere kept its stale draft, while
   * `generalSaved` (derived from the query on every render) went fresh. Autosave
   * then saw draft ≠ saved and dutifully wrote the WHOLE stale draft back,
   * silently reverting every change the other session had made.
   *
   * Now: a key nobody has touched locally follows the server, and a key with an
   * unsaved local edit keeps it (autosave is about to push it). If both changed,
   * the local edit wins and gets saved — last writer, but a deliberate one.
   */
  useEffect(() => {
    if (!settings.length) return;
    const raw = parseSettings(settings);
    const server = Object.fromEntries(
      Object.keys(DEFAULTS).map((key) => [key, key in raw ? raw[key] : DEFAULTS[key]]),
    );
    const prevServer = serverRef.current;
    serverRef.current = server;

    setDraft(prev => {
      if (!prevServer) return { ...prev, ...server }; // first load: the server IS the draft
      const next = { ...prev };
      for (const key of Object.keys(DEFAULTS)) {
        if (sameValue(server[key], prevServer[key])) continue;  // unchanged on the server
        if (!sameValue(prev[key], prevServer[key])) continue;   // unsaved local edit — keep mine
        next[key] = server[key];
      }
      return next;
    });
    // `settings` is structurally shared by the query client, so this runs when
    // the DATA changes, not on every refetch that returns the same rows.
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (entries: Array<[string, unknown]>) =>
      Promise.all(entries.map(([key, value]) =>
        api.put(`/admin/settings/${encodeURIComponent(key)}`, { value }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-settings"] });
      // Feature flags / landing affect the public site + nav immediately.
      qc.invalidateQueries({ queryKey: ["site-config"] });
      qc.invalidateQueries({ queryKey: ["pub-nav-items"] });
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      swalToast(t("settings.toastSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function set(key: string, value: unknown) {
    setDraft(p => ({ ...p, [key]: value }));
  }

  // Auto-save the General-tab settings only. The Beta tab (beta.*) is managed by
  // its own panel/mutations, so those keys are excluded here.
  const GENERAL_KEYS = SECTIONS.flatMap(s => s.fields?.map(f => f.key) ?? s.keys ?? []);
  const rawAll = parseSettings(settings);
  const generalDraft = Object.fromEntries(GENERAL_KEYS.map(k => [k, draft[k]]));
  const generalSaved = settings.length
    ? Object.fromEntries(GENERAL_KEYS.map(k => [k, k in rawAll ? rawAll[k] : DEFAULTS[k]]))
    : undefined;

  /**
   * Save only the keys that actually changed.
   *
   * This used to PUT the whole page — 42 keys — for a single toggle, which is
   * what made a stale tab destructive rather than merely wrong: one save stamped
   * every setting on the page over whatever the server held. Sending just the
   * edits means a save can only ever affect what was edited.
   */
  useAutosave({
    value: generalDraft,
    savedValue: generalSaved,
    onSave: (d) => {
      const changed = Object.entries(d).filter(([key, value]) => !sameValue(value, generalSaved?.[key]));
      if (changed.length) saveMutation.mutate(changed);
    },
  });

  const tzOptions = TIMEZONES.map((tz) => ({ value: tz, label: tz }));

  function renderControl(f: SectionField) {
    const val = draft[f.key];
    switch (f.type) {
      case "toggle":
        return <Toggle on={!!val} onToggle={() => set(f.key, !val)} />;
      case "number":
        return <NumberStepper value={Number(val ?? f.min ?? 0)} onChange={(v) => set(f.key, v)} min={f.min} max={f.max} step={f.step} />;
      case "language":
        return <Select value={String(val ?? "en")} onChange={(v) => set(f.key, v)} options={LOCALES} />;
      case "timezone":
        return <Select value={String(val ?? "UTC")} onChange={(v) => set(f.key, v)} options={tzOptions} />;
      case "select":
        return (
          <Select
            value={String(val ?? "")}
            onChange={(v) => set(f.key, v)}
            options={(f.values ?? []).map((v) => ({ value: v, label: t(`settings.options.${f.optionsKey}.${v}`) }))}
          />
        );
      case "landing":
        return (
          <Select
            value={String(val ?? "home")}
            onChange={(v) => set(f.key, v)}
            options={(siteConfig?.availableLandings ?? []).map((l) => {
              const labelKey = CORE_LANDING_I18N[l.value];
              return { value: l.value, label: labelKey ? t(labelKey) : l.label };
            })}
          />
        );
      case "group":
        return (
          <Select
            value={String(val ?? "admin")}
            onChange={(v) => set(f.key, v)}
            options={allGroups.map((g) => ({ value: g.key, label: g.name }))}
          />
        );
      case "groups": {
        const selected: string[] = Array.isArray(val) ? (val as string[]) : val ? [String(val)] : ["admin"];
        const toggle = (key: string) => {
          const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
          set(f.key, next);
        };
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {allGroups.map((g) => {
              const on = selected.includes(g.key);
              const isAdmin = g.key === "admin"; // admins always bypass — locked on
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => !isAdmin && toggle(g.key)}
                  disabled={isAdmin}
                  title={isAdmin ? "Administrators always have access during maintenance" : undefined}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px",
                    borderRadius: 8, cursor: isAdmin ? "default" : "pointer", fontSize: 13, fontWeight: 600,
                    border: `1px solid ${on || isAdmin ? "var(--c-accent)" : "var(--c-border)"}`,
                    background: on || isAdmin ? "var(--c-accent-soft)" : "var(--c-surface)",
                    color: on || isAdmin ? "var(--c-accent)" : "var(--c-fg-muted)",
                    opacity: isAdmin ? 0.85 : 1,
                  }}
                >
                  {(on || isAdmin) && <FontAwesomeIcon icon={faSquareCheck} />}
                  {g.name}
                </button>
              );
            })}
          </div>
        );
      }
      case "datetime": {
        // Store ISO; the datetime-local input wants "YYYY-MM-DDTHH:mm" in local time.
        const iso = String(val ?? "");
        const local = (() => {
          if (!iso) return "";
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return "";
          const pad = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        })();
        return (
          <input
            type="datetime-local"
            className="inp"
            value={local}
            onChange={(e) => set(f.key, e.target.value ? new Date(e.target.value).toISOString() : "")}
          />
        );
      }
      default:
        return <TextField value={String(val ?? "")} onChange={(v) => set(f.key, v)} placeholder={f.placeholderKey ? t(`settings.placeholders.${f.placeholderKey}`) : undefined} />;
    }
  }

  const pluginSections = slotRegistry.getSettingsSections();
  const panelSaving    = useAnySaving();
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.id);

  /**
   * Switch section, rather than scroll to it.
   *
   * The nav used to be anchors into one very long page: clicking "Members" flung
   * you past six other sections to reach it, and closing the loop meant scrolling
   * all the way back. Each entry now SHOWS its own section and nothing else, so
   * the page is only ever as tall as the thing you asked for.
   *
   * The draft is unaffected — it is one form spanning every section, so a field
   * you edited stays edited (and saved) whether or not it is currently on screen.
   */
  const show = useCallback((id: string) => {
    setActiveSection(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("settings.eyebrow")}</p>
          <h1 className="pg-title">{t("settings.title")}</h1>
          <p className="pg-sub">{t("settings.subtitle")}</p>
        </div>
        {/* One indicator for the whole page. Plugin sections report into it via
            `useReportSaving` rather than rendering a second chip of their own. */}
        <SaveChip saving={saveMutation.isPending || panelSaving} />
      </div>


      <div className="set-layout">
          <nav className="set-secnav">
            <p className="set-secnav__label">{t("settings.onThisPage")}</p>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={activeSection === s.id ? "is-active" : ""}
                onClick={() => show(s.id)}
              >
                <AcpIcon name={s.icon} size={17} />
                <span>{t(`settings.sections.${s.id}.title`)}</span>
              </button>
            ))}
            {/* Plugin sections sit under core's, marked with the extensions icon
                so it is obvious where they came from. Their labels are literals:
                a plugin's language is its own, and core has nothing to look up. */}
            {pluginSections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={activeSection === s.id ? "is-active" : ""}
                onClick={() => show(s.id)}
              >
                <AcpIcon name="puzzle" size={17} />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="set-content">
            {SECTIONS.filter((section) => section.id === activeSection).map((section) => (
              <section key={section.id} className="set-card">
                <div className="set-card__head">
                  <div className="set-card__icon"><AcpIcon name={section.icon} size={19} /></div>
                  <div className="set-card__titles">
                    <h3>{t(`settings.sections.${section.id}.title`)}</h3>
                    <p>{t(`settings.sections.${section.id}.desc`)}</p>
                  </div>
                  {/* Whether the site is actually closed is the first thing an
                      admin opening this card wants to know. */}
                  {section.custom === "maintenance" && (
                    <MaintenanceStatusPill on={draft["maintenance.enabled"] === true} />
                  )}
                </div>
                {section.custom === "maintenance" ? (
                  <MaintenanceSettings draft={draft} set={set} groups={allGroups} />
                ) : (
                <div className="set-rows">
                  {(section.fields ?? []).map((f) => (
                    <div key={f.key} className="set-row">
                      <div>
                        <div className="set-row__label">{t(`settings.fields.${f.i18nKey}.label`)}</div>
                        <div className="set-row__desc">{t(`settings.fields.${f.i18nKey}.desc`)}</div>
                      </div>
                      <div className="set-row__control">{renderControl(f)}</div>
                    </div>
                  ))}
                </div>
                )}
                {section.id === "registration" && draft["auth.registration_mode"] === "invite" && (
                  <div className="set-extra"><InviteCodesPanel /></div>
                )}
              </section>
            ))}

            {/* Core renders the shell so a plugin section cannot look foreign;
                the plugin supplies only the body. Each is isolated — one broken
                plugin must not take the whole Settings page down. */}
            {pluginSections.filter((sec) => sec.id === activeSection).map(({ id, label, description, component: Body }) => (
              <section key={id} className="set-card">
                <div className="set-card__head">
                  <div className="set-card__icon"><AcpIcon name="puzzle" size={19} /></div>
                  <div className="set-card__titles">
                    <h3>{label}</h3>
                    {description && <p>{description}</p>}
                  </div>
                </div>
                <div className="set-card__body">
                  <ErrorBoundary variant="inline"><Body /></ErrorBoundary>
                </div>
              </section>
            ))}
          </div>
        </div>
    </div>
  );
}

// ── Invite codes panel ────────────────────────────────────────────────────────

interface InviteCode {
  id: string; code: string; note: string | null;
  useCount: number; maxUses: number;
  usedAt: string | null; expiresAt: string | null; createdAt: string;
  createdBy: { username: string };
  usedByUser: { username: string } | null;
}

function InviteCodesPanel() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery<{ data: InviteCode[] }>({
    queryKey: ["acp-invite-codes"],
    queryFn:  () => api.get("/admin/invites?limit=50"),
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/admin/invites", { note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-invite-codes"] });
      setNote("");
      swalToast(t("invite.created"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/invites/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-invite-codes"] });
      swalToast(t("invite.revoked"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => swalToast(t("invite.copied"), "success"));
  }

  const codes = data?.data ?? [];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-fg)", marginBottom: 4 }}>
        {t("invite.title")}
      </div>
      <p style={{ fontSize: 12, color: "var(--c-fg-muted)", marginBottom: 14 }}>
        {t("invite.subtitle")}
      </p>

      {/* Generate */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          className="acp-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("invite.notePlaceholder")}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} />
          {t("invite.generate")}
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("invite.loading")}</div>
      ) : codes.length === 0 ? (
        <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("invite.empty")}</div>
      ) : (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {codes.map((c, i) => {
            const used = c.useCount >= c.maxUses;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                  borderBottom: i < codes.length - 1 ? "1px solid var(--c-border)" : "none",
                  opacity: used ? 0.5 : 1,
                }}
              >
                <code style={{ flex: "0 0 auto", fontSize: 13, fontWeight: 700, color: used ? "var(--c-fg-muted)" : "var(--c-accent)", letterSpacing: "0.05em" }}>
                  {c.code}
                </code>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {c.note && <span style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>{c.note}</span>}
                  {used && c.usedByUser && (
                    <span style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
                      {c.note ? " · " : ""}{t("invite.usedBy", { username: c.usedByUser.username })}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: used ? "var(--c-success)" : "var(--c-fg-muted)" }}>
                  {used ? t("invite.used") : t("invite.available")}
                </span>
                {!used && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => copyCode(c.code)} title={t("invite.copy")}>
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                )}
                {!used && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ color: "var(--c-danger)" }}
                    disabled={revokeMut.isPending}
                    onClick={() => revokeMut.mutate(c.id)}
                    title={t("invite.revoke")}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
