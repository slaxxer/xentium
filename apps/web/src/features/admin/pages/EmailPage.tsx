import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { uiLocale } from "../../../lib/i18n";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { sameValue, useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle, TextField, NumberStepper, Button } from "../../../components/AcpControls";
import { AcpIcon } from "./acpIcons";
import { Composer, type ComposerHandle } from "../../../components/composer/Composer";
import { EmailDesignCard, isHex, type EmailDesign } from "./EmailDesign";
import "./acpSystem.scss";
import "./EmailPage.scss";

interface TemplateDraft { subject: string; body: string }

interface Template {
  key: string;
  subject: string;
  body: string;
  placeholders: string[];
  customized: boolean;
  /** Saved as a whole HTML document by an older version: sent as written, not editable here. */
  legacy: boolean;
  updatedAt: string | null;
  defaultSubject: string;
  defaultBody: string;
  /** The shipped version in every language; untouched, each member gets their own. */
  defaults?: Record<string, TemplateDraft>;
}

/**
 * The body in our editor. It reads `initial` once: the parent remounts it (by `key`)
 * on a template switch, a discard or a reset, so typing never re-feeds the editor
 * and moves the cursor.
 */
function TemplateBodyEditor({ initial, onChange, editorRef }: {
  initial: string;
  onChange: (html: string) => void;
  editorRef: React.Ref<ComposerHandle>;
}) {
  const [start] = useState(initial);
  return (
    <Composer ref={editorRef} variant="panel" toolbarPosition="top" minHeight={280}
              mentions={false} submitInBar={false} initialHtml={start} onChange={onChange} />
  );
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
        <Button variant="ghost" className="em-danger"
                disabled={mut.isPending} onClick={() => mut.mutate("")}>
          {t("settings.secret.remove")}
        </Button>
      </div>
    );
  }
  return (
    <div className="em-secret">
      <input type="password" className="inp" autoComplete="new-password" value={entry}
             placeholder={t("settings.secret.placeholder")}
             onChange={(e) => setEntry(e.target.value)} />
      <Button
              disabled={!entry || mut.isPending} onClick={() => mut.mutate(entry)}>
        {t("settings.secret.set")}
      </Button>
    </div>
  );
}

export function EmailPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [section, setSection] = useState("server");
  /**
   * Edited templates, by key — ALL of them, not just the open one. Switching section
   * is not leaving the page, so an unsaved template must survive it; the save bar
   * saves every edited template at once.
   */
  const [tplEdits, setTplEdits] = useState<Record<string, TemplateDraft>>({});
  /** Bumped when the open body is replaced from outside (discard, revert, reset). */
  const [editorEpoch, setEditorEpoch] = useState(0);
  const bodyEditor = useRef<ComposerHandle>(null);
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
  });

  const serverSavedRef = useRef(serverSaved);
  serverSavedRef.current = serverSaved;
  useAutosave({
    value: Object.keys(serverDraft).length ? serverDraft : undefined,
    savedValue: serverSaved,
    // Only the fields that changed are sent.
    onSave: (d) => {
      if (!d) return undefined;
      const changed = Object.entries(d).filter(([k, v]) => !sameValue(v, serverSavedRef.current?.[k]));
      return changed.length ? settingsMut.mutateAsync(changed) : undefined;
    },
    onDiscard: () => { if (serverSavedRef.current) setServerDraft(serverSavedRef.current); },
    describe: (value, saved) => SERVER_FIELDS
      .filter((f) => value && saved && !sameValue(value[f.key], saved[f.key]))
      .map((f) => ({
        key: f.key,
        label: t(`settings.fields.${f.i18nKey}.label`),
        section: t("email.server.title"),
        from: String(saved?.[f.key] ?? ""),
        to: String(value?.[f.key] ?? ""),
        revert: () => setServerDraft((p) => ({ ...p, [f.key]: serverSavedRef.current?.[f.key] })),
      })),
  });

  const settingsMap = useMemo(
    () => Object.fromEntries(settings.map(s => [s.key, s.value])),
    [settings],
  );

  // ── design ─────────────────────────────────────────────────────────────────
  const { data: designData } = useQuery<{ design: EmailDesign; logoAvailable: boolean }>({
    queryKey: ["acp-email-design"],
    queryFn: () => api.get("/admin/email/design"),
  });
  const [designDraft, setDesignDraft] = useState<EmailDesign | null>(null);
  const designSaved = designData?.design;
  // Seeds once; a later refetch must not overwrite what the admin is editing.
  useEffect(() => {
    if (designSaved && !designDraft) setDesignDraft(designSaved);
  }, [designSaved, designDraft]);
  const designSavedRef = useRef(designSaved);
  designSavedRef.current = designSaved;

  const designMut = useMutation({
    mutationFn: (d: EmailDesign) => api.put("/admin/email/design", d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acp-email-design"] }),
  });

  useAutosave({
    value: designDraft ?? undefined,
    savedValue: designSaved,
    // A half-typed colour is not saved; the field shows it is invalid.
    onSave: (d) => (d && isHex(d.accent) && isHex(d.page) ? designMut.mutateAsync(d) : undefined),
    onDiscard: () => { if (designSavedRef.current) setDesignDraft(designSavedRef.current); },
    describe: (value, saved) => (["accent", "page", "header", "footer"] as const)
      .filter((k) => value && saved && value[k] !== saved[k])
      .map((k) => ({
        key: `design.${k}`,
        label: t(`email.design.${k}`),
        section: t("email.design.title"),
        from: k === "header" ? t(`email.design.headers.${saved![k]}`) : String(saved![k]),
        to: k === "header" ? t(`email.design.headers.${value![k]}`) : String(value![k]),
        revert: () => setDesignDraft((p) => (p && designSavedRef.current ? { ...p, [k]: designSavedRef.current[k] } : p)),
      })),
  });

  // ── templates ──────────────────────────────────────────────────────────────
  const active = useMemo(
    () => templates.find(x => x.key === section) ?? null,
    [templates, section],
  );
  /** An untouched template opens in the admin's language; editing it makes that version the site's. */
  const savedTpl = (tpl: Template): TemplateDraft =>
    !tpl.customized && tpl.defaults?.[uiLocale()] ? tpl.defaults[uiLocale()]! : { subject: tpl.subject, body: tpl.body };
  const draft: TemplateDraft | null = active ? tplEdits[active.key] ?? savedTpl(active) : null;
  const setDraft = (next: TemplateDraft) => {
    if (active) setTplEdits((p) => ({ ...p, [active.key]: next }));
  };

  /** What the server has for every template being edited — the draft's baseline. */
  const tplSaved = useMemo(() => {
    if (!templates.length) return undefined;
    return Object.fromEntries(Object.keys(tplEdits).flatMap((k) => {
      const tpl = templates.find((x) => x.key === k);
      return tpl ? [[k, savedTpl(tpl)]] : [];
    }));
  }, [templates, tplEdits]);
  const tplSavedRef = useRef(tplSaved);
  tplSavedRef.current = tplSaved;

  const saveMut = useMutation({
    mutationFn: (changed: Array<[string, TemplateDraft]>) =>
      Promise.all(changed.map(([key, v]) => api.put(`/admin/email/templates/${key}`, v))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acp-email-templates"] }),
  });

  useAutosave({
    value: tplEdits,
    savedValue: tplSaved,
    onSave: (edits) => {
      const changed = Object.entries(edits).filter(([k, v]) => !sameValue(v, tplSavedRef.current?.[k]));
      return changed.length ? saveMut.mutateAsync(changed) : undefined;
    },
    onDiscard: () => { setTplEdits({}); setEditorEpoch((n) => n + 1); },
    describe: (value, saved) => Object.keys(value)
      .filter((k) => !sameValue(value[k], saved[k]))
      .map((k) => {
        const subjectChanged = value[k]!.subject !== saved[k]?.subject;
        return {
          key: k,
          label: t(`email.keys.${k}`),
          section: t("email.title"),
          from: subjectChanged ? saved[k]?.subject ?? "" : t("email.subject"),
          to: subjectChanged ? value[k]!.subject : t("savebar.bodyEdited"),
          revert: () => {
            setTplEdits((p) => { const { [k]: _gone, ...rest } = p; return rest; });
            setEditorEpoch((n) => n + 1);
          },
        };
      }),
  });

  const resetMut = useMutation<Template, unknown, string>({
    mutationFn: (key: string) => api.post(`/admin/email/templates/${key}/reset`, {}) as Promise<Template>,
    onSuccess: (r) => {
      // Back to the default: nothing of this template is left unsaved.
      setTplEdits((p) => { const { [r.key]: _gone, ...rest } = p; return rest; });
      // The editor reopens on the default once the list has it.
      qc.invalidateQueries({ queryKey: ["acp-email-templates"] }).then(() => setEditorEpoch((n) => n + 1));
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


  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("email.eyebrow")}</p>
          <h1 className="pg-title">{t("email.title")}</h1>
          <p className="pg-sub">{t("email.subtitle")}</p>
        </div>
        <SaveChip saving={false} />
      </div>

      <div className="set-layout">
        <nav className="set-secnav">
          <p className="set-secnav__label">{t("email.onThisPage")}</p>
          <button type="button" className={section === "server" ? "is-active" : ""}
                  onClick={() => setSection("server")}>
            <AcpIcon name="cog" size={17} />
            <span>{t("email.server.title")}</span>
          </button>
          <button type="button" className={section === "design" ? "is-active" : ""}
                  onClick={() => setSection("design")}>
            <AcpIcon name="palette" size={17} />
            <span>{t("email.design.title")}</span>
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
                  <Button
                          disabled={!testTo.includes("@") || testMut.isPending || !smtp?.configured}
                          onClick={() => testMut.mutate({ to: testTo, key: "smtp_test" })}>
                    {t("email.sendTest")}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {section === "design" && designDraft && (
            <EmailDesignCard draft={designDraft} onChange={setDesignDraft}
                             logoAvailable={!!designData?.logoAvailable} />
          )}

          {active && draft && (
            <section className="set-card">
              <div className="set-card__head">
                <div className="set-card__icon"><AcpIcon name="mail" size={19} /></div>
                <div className="set-card__titles">
                  <h3>{t(`email.keys.${active.key}`)}</h3>
                  <p>{t("email.templateDesc")}</p>
                  <p className="em-lang">{t(active.customized ? "email.langCustom" : "email.langDefault")}</p>
                </div>
                <Button variant="ghost" className="em-danger"
                        disabled={!active.customized || resetMut.isPending} onClick={onReset}>
                  {t("email.reset")}
                </Button>
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
                    {active.legacy ? (
                      <p className="em-warn">{t("email.legacy")}</p>
                    ) : (
                      <TemplateBodyEditor key={`${active.key}:${editorEpoch}`} initial={draft.body}
                                          editorRef={bodyEditor}
                                          onChange={(html) => setDraft({ ...draft, body: html })} />
                    )}
                  </div>
                </div>
              </div>

              {!active.legacy && (
                <div className="set-extra em-ph">
                  <span className="set-row__label">{t("email.placeholders")}</span>
                  {active.placeholders.map(p => (
                    <button key={p} type="button" className="em-chip" title={t("email.insert")}
                            onClick={() => bodyEditor.current?.insertText(`{{${p}}}`)}>
                      {`{{${p}}}`}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
