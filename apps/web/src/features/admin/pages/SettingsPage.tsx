import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash, faCopy, faSquareCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { AcpIcon, type AcpIconName } from "./acpIcons";

// Core landing values → i18n label keys; plugin destinations use their own label.
/**
 * Write-only setting (currently the SMTP password). The server never returns
 * the stored value — only whether one exists — so this deliberately sits
 * outside the page's autosave: you Set a new value or Remove the existing one.
 */
function SecretField({ settingKey, isSet }: { settingKey: string; isSet: boolean }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [entry, setEntry] = useState("");

  const mut = useMutation({
    mutationFn: (value: string) =>
      api.put(`/admin/settings/${encodeURIComponent(settingKey)}`, { value }),
    onSuccess: (_d, value) => {
      setEntry("");
      qc.invalidateQueries({ queryKey: ["acp-settings"] });
      swalToast(t(value ? "settings.secret.saved" : "settings.secret.removed"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  if (isSet) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="pill pill-ok">{t("settings.secret.configured")}</span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          style={{ color: "var(--c-danger)" }}
          disabled={mut.isPending}
          onClick={() => mut.mutate("")}
        >
          {t("settings.secret.remove")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="password"
        className="inp"
        autoComplete="new-password"
        value={entry}
        placeholder={t("settings.secret.placeholder")}
        onChange={(e) => setEntry(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary btn-sm"
        disabled={!entry || mut.isPending}
        onClick={() => mut.mutate(entry)}
      >
        {t("settings.secret.set")}
      </button>
    </div>
  );
}

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

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`sw${on ? " is-on" : ""}`}
      onClick={onToggle}
    />
  );
}

function TextField({
  value, onChange, placeholder, type = "text",
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      className="inp"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberStepper({
  value, onChange, min = 0, max = 999, step = 1,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  const { t } = useTranslation("common");
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="stepper">
      <button type="button" aria-label={t("actions.decrease")} onClick={() => set(value - step)}>−</button>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? min : Number(e.target.value))}
        onBlur={(e) => set(Number(e.target.value) || min)}
      />
      <button type="button" aria-label={t("actions.increase")} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

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

function SaveChip({ saving }: { saving: boolean }) {
  const { t } = useTranslation("acp");
  return (
    <div className={`savechip ${saving ? "is-saving" : "is-saved"}`} aria-live="polite">
      {saving ? <span className="savechip__spin" /> : <span className="savechip__dot" />}
      <span>{saving ? t("settings.saving") : t("settings.saved")}</span>
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
  type: "text" | "number" | "toggle" | "select" | "language" | "timezone" | "landing" | "group" | "groups" | "datetime" | "secret";
  placeholderKey?: string;
  optionsKey?: string;
  values?: string[];
  min?: number;
  max?: number;
  step?: number;
}

interface Section { id: string; icon: AcpIconName; fields: SectionField[] }

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
    id: "maintenance", icon: "cog",
    fields: [
      { i18nKey: "maintenanceEnabled",        key: "maintenance.enabled",          type: "toggle" },
      { i18nKey: "maintenanceAllowedGroup",   key: "maintenance.allowed_groups",   type: "groups" },
      { i18nKey: "maintenanceTitle",          key: "maintenance.title",            type: "text", placeholderKey: "maintenanceTitle" },
      { i18nKey: "maintenanceMessage",        key: "maintenance.message",          type: "text", placeholderKey: "maintenanceMessage" },
      { i18nKey: "maintenanceProgressLabel",  key: "maintenance.progress_label",   type: "text", placeholderKey: "maintenanceProgressLabel" },
      { i18nKey: "maintenanceProgressPercent",key: "maintenance.progress_percent", type: "number", min: 0, max: 100, step: 5 },
      { i18nKey: "maintenanceEta",            key: "maintenance.eta",              type: "datetime" },
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
  {
    id: "email", icon: "mail",
    fields: [
      // These are the keys the sender actually reads. User/pass stay empty for
      // an unauthenticated local relay (e.g. postfix on 127.0.0.1).
      { i18nKey: "smtpHost",    key: "smtp.host",      type: "text",   placeholderKey: "smtpHost" },
      { i18nKey: "smtpPort",    key: "smtp.port",      type: "number", min: 1, max: 65535, step: 1 },
      { i18nKey: "smtpSecure",  key: "smtp.secure",    type: "toggle" },
      { i18nKey: "smtpUser",    key: "smtp.user",      type: "text",   placeholderKey: "smtpUser" },
      { i18nKey: "smtpPass",    key: "smtp.pass",      type: "secret" },
      { i18nKey: "fromAddress", key: "smtp.from",      type: "text",   placeholderKey: "fromAddress" },
      { i18nKey: "fromName",    key: "smtp.from_name", type: "text",   placeholderKey: "fromName" },
    ],
  },
];

// Default values used until the API responds
const DEFAULTS: Record<string, unknown> = {
  "beta.enabled":                       false,
  "beta.admin_key":                     "",
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
  "maintenance.progress_label":         "In progress",
  "maintenance.progress_percent":       0,
  "maintenance.eta":                    "",
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
  "smtp.host":                          "",
  "smtp.port":                          587,
  "smtp.secure":                        false,
  "smtp.user":                          "",
  "smtp.pass":                          "",
  "smtp.from":                          "",
  "smtp.from_name":                     "",
};

export function SettingsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"general" | "beta">("general");

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

  useEffect(() => {
    if (!settings.length) return;
    const raw = parseSettings(settings);
    setDraft(prev => {
      const next = { ...prev };
      for (const key of Object.keys(DEFAULTS)) {
        if (key in raw) next[key] = raw[key];
      }
      return next;
    });
  }, [settings.length]);

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
  // its own panel/mutations, so those keys are excluded here. Secrets are also
  // excluded: they get explicit Set / Remove actions, because autosaving a
  // half-typed password would store the fragment — and the value we hold in the
  // draft is only a mask anyway.
  const GENERAL_KEYS = SECTIONS.flatMap(s => s.fields.filter(f => f.type !== "secret").map(f => f.key));
  const rawAll = parseSettings(settings);
  const generalDraft = Object.fromEntries(GENERAL_KEYS.map(k => [k, draft[k]]));
  const generalSaved = settings.length
    ? Object.fromEntries(GENERAL_KEYS.map(k => [k, k in rawAll ? rawAll[k] : DEFAULTS[k]]))
    : undefined;

  useAutosave({
    value: generalDraft,
    savedValue: generalSaved,
    onSave: (d) => saveMutation.mutate(Object.entries(d)),
  });

  const tzOptions = TIMEZONES.map((tz) => ({ value: tz, label: tz }));

  function renderControl(f: SectionField) {
    const val = draft[f.key];
    switch (f.type) {
      case "secret":
        return <SecretField settingKey={f.key} isSet={!!val} />;
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

  // Scroll-spy: highlight the section nearest the top of the viewport. The ACP
  // content scrolls with the document, so we listen on window.
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    if (activeTab !== "general") return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        let current = SECTIONS[0]!.id;
        for (const s of SECTIONS) {
          const el = sectionRefs.current[s.id];
          if (!el) continue;
          if (el.getBoundingClientRect().top - 120 <= 0) current = s.id; else break;
        }
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
          current = SECTIONS[SECTIONS.length - 1]!.id;
        }
        setActiveSection(current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [activeTab]);

  const jump = useCallback((id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("settings.eyebrow")}</p>
          <h1 className="pg-title">{t("settings.title")}</h1>
          <p className="pg-sub">{t("settings.subtitle")}</p>
        </div>
        {activeTab === "general" && <SaveChip saving={saveMutation.isPending} />}
      </div>

      {/* Tab bar — keeps the General / Beta switch */}
      <div style={{ display: "flex", gap: 2, marginBottom: 22, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", padding: 3, maxWidth: 320 }}>
        {(["general", "beta"] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "7px 14px", borderRadius: "calc(var(--radius-sm) - 2px)",
              border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 13, fontWeight: 600, transition: "background .15s, color .15s",
              background: activeTab === tab ? "var(--c-card)" : "transparent",
              color: activeTab === tab ? "var(--c-fg)" : "var(--c-fg-muted)",
            }}
          >
            {tab === "general" ? t("settings.tabGeneral") : t("settings.tabBeta")}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="set-layout">
          <nav className="set-secnav">
            <p className="set-secnav__label">{t("settings.onThisPage")}</p>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={activeSection === s.id ? "is-active" : ""}
                onClick={() => jump(s.id)}
              >
                <AcpIcon name={s.icon} size={17} />
                <span>{t(`settings.sections.${s.id}.title`)}</span>
              </button>
            ))}
          </nav>

          <div className="set-content">
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                className="set-card"
                ref={(el) => { sectionRefs.current[section.id] = el; }}
              >
                <div className="set-card__head">
                  <div className="set-card__icon"><AcpIcon name={section.icon} size={19} /></div>
                  <div className="set-card__titles">
                    <h3>{t(`settings.sections.${section.id}.title`)}</h3>
                    <p>{t(`settings.sections.${section.id}.desc`)}</p>
                  </div>
                </div>
                <div className="set-rows">
                  {section.fields.map((f) => (
                    <div key={f.key} className="set-row">
                      <div>
                        <div className="set-row__label">{t(`settings.fields.${f.i18nKey}.label`)}</div>
                        <div className="set-row__desc">{t(`settings.fields.${f.i18nKey}.desc`)}</div>
                      </div>
                      <div className="set-row__control">{renderControl(f)}</div>
                    </div>
                  ))}
                </div>
                {section.id === "registration" && draft["auth.registration_mode"] === "invite" && (
                  <div className="set-extra"><InviteCodesPanel /></div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}

      {activeTab === "beta" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <BetaSettingsPanel draft={draft} set={set} />
          </div>
          <BetaLogCard betaOn={Boolean(draft["beta.enabled"])} />
        </div>
      )}
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

// ── Beta settings panel ───────────────────────────────────────────────────────

interface BetaCode {
  id: string; code: string; note: string | null;
  redeemerIp: string | null; redeemedAt: string | null; createdAt: string;
  createdBy:      { username: string };
  registeredUser: { username: string } | null;
}

function saveSetting(key: string, value: unknown) {
  return api.put(`/admin/settings/${encodeURIComponent(key)}`, { value });
}

function BetaSettingsPanel({
  draft,
  set,
}: {
  draft: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [note,    setNote]    = useState("");
  const betaOn = Boolean(draft["beta.enabled"]);

  const { data, isLoading } = useQuery<{ data: BetaCode[] }>({
    queryKey: ["acp-beta-codes"],
    queryFn:  () => api.get("/admin/beta-codes?limit=50"),
  });

  // Own mutation — isolated from the general settings save
  const toggleMut = useMutation({
    mutationFn: (next: boolean) => saveSetting("beta.enabled", next),
    onMutate:   (next) => { set("beta.enabled", next); },          // optimistic
    onError:    (_e, next) => { set("beta.enabled", !next); swalToast(t("beta.saveFailed")); }, // revert
    onSuccess:  (_r, next) => swalToast(next ? t("beta.enabled") : t("beta.disabled"), "success"),
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/admin/beta-codes", { note: note.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acp-beta-codes"] }); setNote(""); swalToast(t("beta.created"), "success"); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/beta-codes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acp-beta-codes"] }); swalToast(t("beta.deleted"), "success"); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => swalToast(t("beta.copied"), "success"));
  }

  const codes = data?.data ?? [];

  return (
    <>
      {/* Toggle card */}
      <div className="acp-card" style={{ padding: "24px" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 4 }}>{t("beta.modeTitle")}</div>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 16 }}>
          {t("beta.modeDesc")}
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-fg)" }}>{t("beta.enable")}</div>
            <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 2 }}>
              {t("beta.enableDesc")}
            </div>
          </div>
          <Toggle on={betaOn} onToggle={() => !toggleMut.isPending && toggleMut.mutate(!betaOn)} />
        </div>
      </div>

      {/* Beta codes + admin key — dimmed when beta is OFF */}
      <div style={{ opacity: betaOn ? 1 : 0.5, pointerEvents: betaOn ? "auto" : "none", transition: "opacity .2s" }}>

      {/* Beta codes card */}
      <div className="acp-card" style={{ padding: "24px" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 4 }}>{t("beta.codesTitle")}</div>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 18 }}>
          {t("beta.codesDesc")}
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            className="acp-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("beta.notePlaceholder")}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary btn-sm" disabled={createMut.isPending} onClick={() => createMut.mutate()}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} /> {t("beta.generate")}
          </button>
        </div>

        {isLoading ? (
          <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("beta.loading")}</div>
        ) : codes.length === 0 ? (
          <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("beta.empty")}</div>
        ) : (
          <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
            {codes.map((c, i) => {
              const redeemed = !!c.redeemedAt;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < codes.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                  <code style={{ flex: "0 0 auto", fontSize: 13, fontWeight: 700, color: redeemed ? "var(--c-fg-muted)" : "var(--c-accent)", letterSpacing: "0.05em" }}>
                    {c.code}
                  </code>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--c-fg-muted)" }}>
                    {c.note && <span>{c.note}</span>}
                    {c.registeredUser
                      ? <span style={{ color: "var(--c-success)" }}>{c.note ? " · " : ""}{t("beta.registeredAs", { username: c.registeredUser.username })}</span>
                      : redeemed && c.redeemerIp
                        ? <span>{c.note ? " · " : ""}{t("beta.lockedTo", { ip: c.redeemerIp })}</span>
                        : null
                    }
                  </div>
                  <span style={{ fontSize: 11, flexShrink: 0, color: c.registeredUser ? "var(--c-success)" : redeemed ? "var(--c-warn)" : "var(--c-fg-muted)" }}>
                    {c.registeredUser ? t("beta.statusRegistered") : redeemed ? t("beta.statusRedeemed") : t("beta.statusAvailable")}
                  </span>
                  {!redeemed && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => copyCode(c.code)} title={t("beta.copy")}>
                      <FontAwesomeIcon icon={faCopy} />
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-sm" style={{ color: "var(--c-danger)" }} disabled={revokeMut.isPending} onClick={() => revokeMut.mutate(c.id)} title={t("beta.delete")}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      </div> {/* end dim wrapper */}
    </>
  );
}

// ── Beta activity log card ────────────────────────────────────────────────────

interface BetaLogEntry {
  id: string;
  eventType: "page_visit" | "login" | "failed_redeem";
  betaCode: string | null;
  userId: string | null;
  username: string | null;
  url: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function parseDevice(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/mobile/i.test(ua)) return "Mobile";
  if (/tablet/i.test(ua)) return "Tablet";
  return "Desktop";
}

function parseBrowser(ua: string | null): string {
  if (!ua) return "";
  if (/Firefox\//.test(ua))  return "Firefox";
  if (/Edg\//.test(ua))      return "Edge";
  if (/Chrome\//.test(ua))   return "Chrome";
  if (/Safari\//.test(ua))   return "Safari";
  return "Browser";
}

function shortDate(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const EVENT_META: Record<string, { labelKey: string; color: string }> = {
  page_visit:    { labelKey: "beta.eventVisit",   color: "var(--c-accent)"  },
  login:         { labelKey: "beta.eventLogin",   color: "var(--c-success)" },
  failed_redeem: { labelKey: "beta.eventBlocked", color: "var(--c-danger)"  },
};

function BetaLogCard({ betaOn }: { betaOn: boolean }) {
  const { t } = useTranslation("acp");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{ data: BetaLogEntry[]; meta: { total: number; totalPages: number } }>({
    queryKey:        ["acp-beta-log", page],
    queryFn:         () => api.get(`/admin/beta-codes/log?page=${page}&limit=20`),
    refetchInterval: 15_000,
  });

  const entries    = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div
      className="acp-card"
      style={{ padding: "24px", opacity: betaOn ? 1 : 0.5, pointerEvents: betaOn ? "auto" : "none", transition: "opacity .2s" }}
    >
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 4 }}>
        {t("beta.logTitle")}
      </div>
      <p style={{ fontSize: 12, color: "var(--c-fg-muted)", marginBottom: 16 }}>
        {t("beta.logDesc")}
      </p>

      {isLoading ? (
        <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("beta.loading")}</div>
      ) : entries.length === 0 ? (
        <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("beta.logEmpty")}</div>
      ) : (
        <div style={{ maxHeight: 455, overflowY: "auto", paddingRight: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {entries.map((e) => {
            const meta      = EVENT_META[e.eventType];
            const eventLabel = meta ? t(meta.labelKey) : e.eventType;
            const eventColor = meta?.color ?? "var(--c-fg-muted)";
            const isFailed  = e.eventType === "failed_redeem";
            const device    = parseDevice(e.userAgent);
            const browser   = parseBrowser(e.userAgent);

            return (
              <div
                key={e.id}
                style={{
                  padding:      "9px 12px",
                  borderRadius: "var(--radius-sm)",
                  background:   isFailed ? "rgba(248,113,113,0.07)" : "var(--c-surface)",
                  border:       `1px solid ${isFailed ? "rgba(248,113,113,0.25)" : "var(--c-border)"}`,
                  marginBottom: 4,
                }}
              >
                {/* Top row: badge + url/event + time */}
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                    background: `${eventColor}20`, color: eventColor, border: `1px solid ${eventColor}30`,
                    flexShrink: 0,
                  }}>
                    {eventLabel}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isFailed ? "var(--c-danger)" : "var(--c-fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.url ?? (e.eventType === "login" ? t("beta.loggedIn") : e.eventType === "failed_redeem" ? t("beta.blockedAttempt") : "—")}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--c-fg-muted)", flexShrink: 0 }}>
                    {shortDate(e.createdAt)}
                  </span>
                </div>

                {/* Bottom row: user + code + IP + device */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {e.username && (
                    <span style={{ fontSize: 11, color: "var(--c-accent)" }}>@{e.username}</span>
                  )}
                  {e.betaCode && (
                    <code style={{ fontSize: 10, color: "var(--c-fg-muted)" }}>{e.betaCode}</code>
                  )}
                  {e.ip && (
                    <span style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>📍 {e.ip}</span>
                  )}
                  {e.userAgent && (
                    <span style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>
                      {device}{browser ? ` · ${browser}` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <button type="button" className="btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t("beta.prev")}</button>
          <span style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>{page} / {totalPages}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("beta.next")}</button>
        </div>
      )}
    </div>
  );
}
