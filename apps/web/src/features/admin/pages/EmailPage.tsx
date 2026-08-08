import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle, TextField, NumberStepper } from "../../../components/AcpControls";
import { AcpIcon } from "./acpIcons";
import "./acpSystem.scss";
import "./EmailPage.scss";

interface Template {
  key: string;
  subject: string;
  body: string;
  placeholders: string[];
  customized: boolean;
  updatedAt: string | null;
  defaultSubject: string;
  defaultBody: string;
}

interface SmtpStatus { configured: boolean; reachable: boolean; error: string | null }
interface Setting { key: string; value: unknown }

// Server fields, in the same shape SettingsPage uses so the rows render
// identically. i18n keys stay under settings.fields.* — the strings did not
// change, only which page shows them.
const SERVER_FIELDS = [
  { i18nKey: "smtpHost",    key: "smtp.host",      type: "text",   placeholderKey: "smtpHost" },
  { i18nKey: "smtpPort",    key: "smtp.port",      type: "number", min: 1, max: 65535, step: 1 },
  { i18nKey: "smtpSecure",  key: "smtp.secure",    type: "toggle" },
  { i18nKey: "smtpUser",    key: "smtp.user",      type: "text",   placeholderKey: "smtpUser" },
  { i18nKey: "smtpPass",    key: "smtp.pass",      type: "secret" },
  { i18nKey: "fromAddress", key: "smtp.from",      type: "text",   placeholderKey: "fromAddress" },
  { i18nKey: "fromName",    key: "smtp.from_name", type: "text",   placeholderKey: "fromName" },
] as const;

const SERVER_DEFAULTS: Record<string, unknown> = {
  "smtp.host": "", "smtp.port": 587, "smtp.secure": false,
  "smtp.user": "", "smtp.pass": "", "smtp.from": "", "smtp.from_name": "",
};

/**
 * Write-only setting (the SMTP password). The server never returns the stored
 * value — only whether one exists — so this sits outside autosave: you Set a
 * new value or Remove the existing one. Autosaving would persist a half-typed
 * password, and the value in the draft is only a mask anyway.
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
      qc.invalidateQueries({ queryKey: ["acp-email-status"] });
      toast.success(t(value ? "settings.secret.saved" : "settings.secret.removed"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (isSet) {
    return (
      <div className="em-secret">
        <span className="em-secret__pill">{t("settings.secret.configured")}</span>
        <button type="button" className="btn-ghost btn-sm em-danger"
                disabled={mut.isPending} onClick={() => mut.mutate("")}>
          {t("settings.secret.remove")}
        </button>
      </div>
    );
  }
  return (
    <div className="em-secret">
      <input type="password" className="inp" autoComplete="new-password" value={entry}
             placeholder={t("settings.secret.placeholder")}
             onChange={(e) => setEntry(e.target.value)} />
      <button type="button" className="btn-primary btn-sm"
              disabled={!entry || mut.isPending} onClick={() => mut.mutate(entry)}>
        {t("settings.secret.set")}
      </button>
    </div>
  );
}

export function EmailPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [section, setSection] = useState("server");
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [testTo, setTestTo] = useState("");

  const { data: settings = [] } = useQuery<Setting[]>({
    queryKey: ["acp-settings"],
    queryFn: () => api.get("/admin/settings"),
  });
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["acp-email-templates"],
    queryFn: () => api.get("/admin/email/templates"),
  });
  const { data: smtp } = useQuery<SmtpStatus>({
    queryKey: ["acp-email-status"],
    queryFn: () => api.get("/admin/email/status"),
  });

  // ── server settings ────────────────────────────────────────────────────────
  const [serverDraft, setServerDraft] = useState<Record<string, unknown>>({});
  const serverSaved = useMemo(() => {
    if (!settings.length) return undefined;
    const m = Object.fromEntries(settings.map(s => [s.key, s.value]));
    return Object.fromEntries(
      SERVER_FIELDS.filter(f => f.type !== "secret")
        .map(f => [f.key, f.key in m ? m[f.key] : SERVER_DEFAULTS[f.key]]),
    );
  }, [settings]);

  // Seeds once, when the settings query first resolves. Deliberately not
  // re-seeding on later refetches — that would discard whatever the admin is
  // mid-way through typing.
  useEffect(() => {
    if (serverSaved && !Object.keys(serverDraft).length) setServerDraft(serverSaved);
  }, [serverSaved, serverDraft]);

  const settingsMut = useMutation({
    mutationFn: (entries: Array<[string, unknown]>) =>
      Promise.all(entries.map(([key, value]) =>
        api.put(`/admin/settings/${encodeURIComponent(key)}`, { value }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-settings"] });
      qc.invalidateQueries({ queryKey: ["acp-email-status"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useAutosave({
    value: Object.keys(serverDraft).length ? serverDraft : undefined,
    savedValue: serverSaved,
    onSave: (d) => { if (d) settingsMut.mutate(Object.entries(d)); },
  });

  const settingsMap = useMemo(
    () => Object.fromEntries(settings.map(s => [s.key, s.value])),
    [settings],
  );

  // ── templates ──────────────────────────────────────────────────────────────
  const active = useMemo(
    () => templates.find(x => x.key === section) ?? null,
    [templates, section],
  );

  // Seed the draft once per section. The ref is what makes `templates` safe to
  // depend on: without it, every refetch of the list would re-seed and wipe out
  // whatever the admin was part-way through typing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === section) return;
    if (section === "server") { setDraft(null); seededFor.current = section; return; }
    const tpl = templates.find(x => x.key === section);
    if (tpl) {
      setDraft({ subject: tpl.subject, body: tpl.body });
      seededFor.current = section;
    }
  }, [section, templates]);

  const saveMut = useMutation({
    mutationFn: (v: { subject: string; body: string }) =>
      api.put(`/admin/email/templates/${section}`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acp-email-templates"] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useAutosave({
    value: draft,
    savedValue: active ? { subject: active.subject, body: active.body } : undefined,
    onSave: (d) => { if (d && active) saveMut.mutate(d); },
  });

  const resetMut = useMutation<Template, unknown, string>({
    mutationFn: (key: string) => api.post(`/admin/email/templates/${key}/reset`, {}) as Promise<Template>,
    onSuccess: (r) => {
      // seededFor already points at this section, so the effect will not
      // re-seed — set the draft directly from the server's response.
      setDraft({ subject: r.subject, body: r.body });
      qc.invalidateQueries({ queryKey: ["acp-email-templates"] });
      toast.success(t("email.resetDone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const testMut = useMutation({
    mutationFn: (v: { to: string; key: string }) => api.post("/admin/email/test", v),
    onSuccess: (_r, v) => toast.success(t("email.testSent", { to: v.to })),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function onReset() {
    if (!active) return;
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("email.resetTitle"),
      body: t("email.resetConfirm"),
      confirmText: t("email.reset"),
      danger: true,
    });
    if (ok) resetMut.mutate(active.key);
  }

  function renderControl(f: (typeof SERVER_FIELDS)[number]) {
    const val = serverDraft[f.key];
    const set = (v: unknown) => setServerDraft(p => ({ ...p, [f.key]: v }));
    switch (f.type) {
      case "toggle":
        return <Toggle on={!!val} onToggle={() => set(!val)} />;
      case "number":
        return <NumberStepper value={Number(val ?? 587)} onChange={set}
                              min={f.min} max={f.max} step={f.step} />;
      case "secret":
        return <SecretField settingKey={f.key} isSet={!!settingsMap[f.key]} />;
      default:
        return <TextField value={String(val ?? "")} onChange={set}
                          placeholder={f.placeholderKey ? t(`settings.placeholders.${f.placeholderKey}`) : undefined} />;
    }
  }

  const saving = settingsMut.isPending || saveMut.isPending;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("email.eyebrow")}</p>
          <h1 className="pg-title">{t("email.title")}</h1>
          <p className="pg-sub">{t("email.subtitle")}</p>
        </div>
        <SaveChip saving={saving} />
      </div>

      <div className="set-layout">
        <nav className="set-secnav">
          <p className="set-secnav__label">{t("email.onThisPage")}</p>
          <button type="button" className={section === "server" ? "is-active" : ""}
                  onClick={() => setSection("server")}>
            <AcpIcon name="cog" size={17} />
            <span>{t("email.server.title")}</span>
          </button>
          {templates.map(tpl => (
            <button key={tpl.key} type="button"
                    className={section === tpl.key ? "is-active" : ""}
                    onClick={() => setSection(tpl.key)}>
              <AcpIcon name="mail" size={17} />
              <span>{t(`email.keys.${tpl.key}`)}</span>
              {tpl.customized && <span className="em-dot" title={t("email.customized")} />}
            </button>
          ))}
        </nav>

        <div className="set-content">
          {section === "server" && (
            <section className="set-card">
              <div className="set-card__head">
                <div className="set-card__icon"><AcpIcon name="cog" size={19} /></div>
                <div className="set-card__titles">
                  <h3>{t("email.server.title")}</h3>
                  <p>{t("email.server.desc")}</p>
                </div>
              </div>

              {smtp && !smtp.configured && <div className="em-warn">{t("email.smtpMissing")}</div>}
              {smtp?.configured && !smtp.reachable && (
                <div className="em-warn">{t("email.smtpUnreachable", { error: smtp.error ?? "" })}</div>
              )}

              <div className="set-rows">
                {SERVER_FIELDS.map(f => (
                  <div key={f.key} className="set-row">
                    <div>
                      <div className="set-row__label">{t(`settings.fields.${f.i18nKey}.label`)}</div>
                      <div className="set-row__desc">{t(`settings.fields.${f.i18nKey}.desc`)}</div>
                    </div>
                    <div className="set-row__control">{renderControl(f)}</div>
                  </div>
                ))}
              </div>

              <div className="set-extra em-testbar">
                <div>
                  <div className="set-row__label">{t("email.testTitle")}</div>
                  <div className="set-row__desc">{t("email.testDesc")}</div>
                </div>
                <div className="em-testbar__actions">
                  <input type="email" className="inp" value={testTo}
                         placeholder={t("email.testPlaceholder")}
                         onChange={(e) => setTestTo(e.target.value)} />
                  <button type="button" className="btn-primary btn-sm"
                          disabled={!testTo.includes("@") || testMut.isPending || !smtp?.configured}
                          onClick={() => testMut.mutate({ to: testTo, key: "smtp_test" })}>
                    {t("email.sendTest")}
                  </button>
                </div>
              </div>
            </section>
          )}

          {active && draft && (
            <section className="set-card">
              <div className="set-card__head">
                <div className="set-card__icon"><AcpIcon name="mail" size={19} /></div>
                <div className="set-card__titles">
                  <h3>{t(`email.keys.${active.key}`)}</h3>
                  <p>{t("email.templateDesc")}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm em-danger"
                        disabled={!active.customized || resetMut.isPending} onClick={onReset}>
                  {t("email.reset")}
                </button>
              </div>

              <div className="set-rows">
                <div className="set-row em-row-stack">
                  <div>
                    <div className="set-row__label">{t("email.subject")}</div>
                    <div className="set-row__desc">{t("email.subjectDesc")}</div>
                  </div>
                  <div className="set-row__control em-full">
                    <TextField value={draft.subject}
                               onChange={(v) => setDraft({ ...draft, subject: v })} />
                  </div>
                </div>

                <div className="set-row em-row-stack">
                  <div>
                    <div className="set-row__label">{t("email.body")}</div>
                    <div className="set-row__desc">{t("email.bodyDesc")}</div>
                  </div>
                  <div className="set-row__control em-full">
                    <textarea className="inp em-body" spellCheck={false} value={draft.body}
                              onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="set-extra em-ph">
                <span className="set-row__label">{t("email.placeholders")}</span>
                {active.placeholders.map(p => (
                  <button key={p} type="button" className="em-chip" title={t("email.insert")}
                          onClick={() => setDraft({ ...draft, body: `${draft.body}{{${p}}}` })}>
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
