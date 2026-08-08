import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import "./acpSystem.scss";
import "./EmailTemplatesPage.scss";

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

interface SmtpStatus {
  configured: boolean;
  reachable: boolean;
  error: string | null;
}

export function EmailTemplatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [testTo, setTestTo] = useState("");

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["acp-email-templates"],
    queryFn: () => api.get("/admin/email/templates"),
  });

  const { data: smtp } = useQuery<SmtpStatus>({
    queryKey: ["acp-email-status"],
    queryFn: () => api.get("/admin/email/status"),
  });

  const active = useMemo(
    () => templates.find(x => x.key === (selected ?? templates[0]?.key)) ?? null,
    [templates, selected],
  );

  // Reset the draft whenever a different template is opened, so edits to one
  // can never be autosaved onto another. Keyed on the template key alone:
  // re-running on every `active` identity change would clobber in-progress
  // edits each time the list query refetches.
  const activeKey = active?.key;
  useEffect(() => {
    const tpl = templates.find(x => x.key === activeKey);
    if (tpl) setDraft({ subject: tpl.subject, body: tpl.body });
  }, [activeKey]);

  const saveMut = useMutation({
    mutationFn: (v: { subject: string; body: string }) =>
      api.put(`/admin/email/templates/${active!.key}`, v),
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
      setDraft({ subject: r.subject, body: r.body });
      qc.invalidateQueries({ queryKey: ["acp-email-templates"] });
      toast.success(t("emailTemplates.resetDone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const testMut = useMutation({
    mutationFn: (v: { to: string; key: string }) => api.post("/admin/email/test", v),
    onSuccess: (_r, v) => toast.success(t("emailTemplates.testSent", { to: v.to })),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function onReset() {
    if (!active) return;
    const ok = await openDialog({
      kind: "confirm",
      icon: "warning",
      title: t("emailTemplates.resetTitle"),
      body: t("emailTemplates.resetConfirm"),
      confirmText: t("emailTemplates.reset"),
      danger: true,
    });
    if (ok) resetMut.mutate(active.key);
  }

  if (isLoading) return <div className="acp-page"><p>{t("common.loading")}</p></div>;

  return (
    <div className="acp-page nv-email-templates">
      <header className="acp-page-head">
        <span className="acp-eyebrow">{t("emailTemplates.eyebrow")}</span>
        <h1>{t("emailTemplates.title")}</h1>
        <p className="acp-sub">{t("emailTemplates.subtitle")}</p>
      </header>

      {smtp && !smtp.configured && (
        <div className="nv-et-warn">{t("emailTemplates.smtpMissing")}</div>
      )}
      {smtp?.configured && !smtp.reachable && (
        <div className="nv-et-warn">
          {t("emailTemplates.smtpUnreachable", { error: smtp.error ?? "" })}
        </div>
      )}

      <div className="nv-et-grid">
        <aside className="nv-et-list">
          {templates.map(tpl => (
            <button
              key={tpl.key}
              type="button"
              className={`nv-et-item${tpl.key === active?.key ? " is-active" : ""}`}
              onClick={() => setSelected(tpl.key)}
            >
              <span>{t(`emailTemplates.keys.${tpl.key}`)}</span>
              {tpl.customized && <span className="nv-et-dot" title={t("emailTemplates.customized")} />}
            </button>
          ))}
        </aside>

        <section className="nv-et-editor">
          {active && draft && (
            <>
              <div className="nv-et-toolbar">
                <AutosaveStatus saving={saveMut.isPending} />
                <div className="nv-et-actions">
                  {/* Inline rather than a dialog: openDialog only resolves a
                      boolean, and a recipient you retype on every send is
                      exactly the thing you want visible while testing. */}
                  <input
                    type="email"
                    className="inp nv-et-testto"
                    value={testTo}
                    placeholder={t("emailTemplates.testPlaceholder")}
                    onChange={(e) => setTestTo(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => testMut.mutate({ to: testTo, key: active.key })}
                    disabled={!testTo.includes("@") || testMut.isPending || !smtp?.configured}
                  >
                    {t("emailTemplates.sendTest")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ color: "var(--c-danger)" }}
                    onClick={onReset}
                    disabled={!active.customized || resetMut.isPending}
                  >
                    {t("emailTemplates.reset")}
                  </button>
                </div>
              </div>

              <label className="nv-et-label" htmlFor="et-subject">{t("emailTemplates.subject")}</label>
              <input
                id="et-subject"
                className="inp"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />

              <label className="nv-et-label" htmlFor="et-body">{t("emailTemplates.body")}</label>
              <textarea
                id="et-body"
                className="inp nv-et-body"
                spellCheck={false}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />

              <div className="nv-et-ph">
                <span className="nv-et-ph-label">{t("emailTemplates.placeholders")}</span>
                {active.placeholders.map(p => (
                  <button
                    key={p}
                    type="button"
                    className="nv-et-chip"
                    title={t("emailTemplates.insert")}
                    onClick={() => setDraft({ ...draft, body: `${draft.body}{{${p}}}` })}
                  >
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
