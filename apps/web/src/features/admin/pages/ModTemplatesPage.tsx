import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faMagnifyingGlass, faPlus, faCopy, faTrash, faShieldHalved, faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/time";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import {
  DURATIONS, DURATION_LABEL, DURATION_TEXT, MODES, fillSegments,
  type Duration, type Mode, type Template,
} from "../../modcp/modTemplates";
import "./ModTemplatesPage.scss";

/**
 * ACP → Moderation → Templates.
 *
 * The premade texts moderators start from in ModCanvas (warn, ban, remove, dismiss).
 * Admins write their own here or keep the default set; ModCanvas only READS them.
 * Every site starts with the defaults, and "Restore defaults" brings back any that
 * were deleted without touching the ones an admin reworded.
 */

type AdminTemplate = Template & { isDefault: boolean };

interface Draft {
  mode: Mode; name: string; text: string; ruleRef: string;
  defaultDuration: Duration | null; matchCategories: string;
}
const draftOf = (t: Template): Draft => ({
  mode: t.mode, name: t.name, text: t.text, ruleRef: t.ruleRef ?? "",
  defaultDuration: t.mode === "ban" ? (t.defaultDuration ?? "7d") : null,
  matchCategories: t.matchCategories.join(", "),
});
const payloadOf = (d: Draft) => ({
  mode: d.mode, name: d.name.trim() || "Untitled", text: d.text.trim() || "…", ruleRef: d.ruleRef.trim() || null,
  defaultDuration: d.mode === "ban" ? (d.defaultDuration ?? "7d") : null,
  matchCategories: d.matchCategories.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean),
});

const KEY = ["acp-mod-templates"] as const;

export function ModTemplatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: templates = [], isLoading } = useQuery<AdminTemplate[]>({
    queryKey: KEY,
    queryFn: () => api.get("/admin/mod-templates"),
  });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = params.get("id");
  const select = (id: string | null) => setParams((p) => { if (id) p.set("id", id); else p.delete("id"); return p; }, { replace: true });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? templates.filter((x) => `${x.name} ${x.text} ${x.ruleRef ?? ""}`.toLowerCase().includes(q)) : templates;
  }, [templates, search]);
  const current = templates.find((x) => x.id === selected) ?? templates[0] ?? null;

  // ModCanvas reads the same texts; keep its copy in step with every change here.
  const touched = () => qc.invalidateQueries({ queryKey: ["mod-templates"] });

  const create = useMutation({
    mutationFn: (body: object) => api.post<AdminTemplate>("/admin/mod-templates", body),
    onSuccess: (row) => {
      qc.setQueryData<AdminTemplate[]>(KEY, (old) => [...(old ?? []), { ...row, isDefault: false }]);
      select(row.id);
      touched();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: () => api.post<{ restored: number }>("/admin/mod-templates/restore-defaults"),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      touched();
      toast.success(res.restored ? t("modTemplates.restored", { count: res.restored }) : t("modTemplates.restoredNone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function confirmRestore() {
    const ok = await openDialog({
      kind: "confirm", icon: "question",
      title: t("modTemplates.restoreTitle"),
      body: t("modTemplates.restoreBody"),
      confirmText: t("modTemplates.restoreConfirm"),
      cancelText: t("common:actions.cancel"),
    });
    if (ok) restore.mutate();
  }

  return (
    <div className="mtp">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("modTemplates.eyebrow")}</p>
          <h1 className="pg-title">{t("modTemplates.title")}</h1>
          <p className="pg-sub">{t("modTemplates.sub")}</p>
        </div>
        <SaveChip saving={saving} />
      </div>

      <div className="mtp-layout">
        <aside className="set-card mtp-list">
          <div className="mtp-list__top">
            <label className="mtp-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("modTemplates.search")} />
            </label>
            <button type="button" className="btn-primary btn-sm" disabled={create.isPending}
              onClick={() => create.mutate({ mode: "warn", name: t("modTemplates.newName"), text: "Hi {user}, " })}>
              <FontAwesomeIcon icon={faPlus} /> {t("modTemplates.new")}
            </button>
          </div>
          <div className="mtp-list__rows">
            {isLoading && <p className="mtp-muted mtp-pad">{t("sidebar.loading")}</p>}
            {MODES.map((mode) => {
              const items = visible.filter((x) => x.mode === mode);
              if (!items.length) return null;
              return (
                <div key={mode}>
                  <div className="mtp-group"><span>{t(`modTemplates.group.${mode}`)}</span><span>{items.length}</span></div>
                  {items.map((x) => (
                    <button key={x.id} type="button" className={`mtp-item${current?.id === x.id ? " is-on" : ""}`} onClick={() => select(x.id)}>
                      <span className="mtp-item__txt">
                        <b>{x.name}</b>
                        <span>
                          {x.mode === "ban"
                            ? (x.defaultDuration === "perm" ? t("modTemplates.permanent") : t("modTemplates.defaultLen", { len: DURATION_LABEL[x.defaultDuration ?? "7d"] }))
                            : x.internal ? t("modTemplates.internal") : (x.ruleRef ?? t("modTemplates.noRule"))}
                        </span>
                      </span>
                      <span className="mtp-item__n">{x.useCount}×</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {!isLoading && templates.length === 0 && <p className="mtp-muted mtp-pad">{t("modTemplates.empty")}</p>}
          </div>
          <div className="mtp-list__foot">
            <button type="button" className="btn-ghost btn-sm" disabled={restore.isPending} onClick={confirmRestore}>
              <FontAwesomeIcon icon={faRotateLeft} /> {t("modTemplates.restore")}
            </button>
          </div>
        </aside>

        <section className="set-card mtp-editor">
          {current ? (
            <Editor
              key={current.id}
              template={current}
              onSaving={setSaving}
              onChanged={touched}
              onDuplicate={() => create.mutate({ ...payloadOf(draftOf(current)), name: t("modTemplates.copyName", { name: current.name }) })}
              onDeleted={() => { select(null); touched(); }}
            />
          ) : !isLoading && (
            <p className="mtp-muted mtp-pad">{t("modTemplates.empty")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Editor({ template, onSaving, onChanged, onDuplicate, onDeleted }: {
  template: AdminTemplate;
  onSaving: (v: boolean) => void;
  onChanged: () => void;
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(template));
  const textRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (d: Draft) => api.patch<Template>(`/admin/mod-templates/${template.id}`, payloadOf(d)),
    onSuccess: (row) => {
      qc.setQueryData<AdminTemplate[]>(KEY, (old) => (old ?? []).map((x) => (x.id === row.id ? { ...x, ...row } : x)));
      onChanged();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  useEffect(() => { onSaving(save.isPending); }, [save.isPending, onSaving]);
  useAutosave({ value: payloadOf(draft), savedValue: payloadOf(draftOf(template)), onSave: () => save.mutate(draft), delay: 700 });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/mod-templates/${template.id}`),
    onSuccess: () => {
      qc.setQueryData<AdminTemplate[]>(KEY, (old) => (old ?? []).filter((x) => x.id !== template.id));
      onDeleted();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function confirmDelete() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("modTemplates.deleteTitle", { name: template.name }),
      body: t(template.isDefault ? "modTemplates.deleteBodyDefault" : "modTemplates.deleteBody"),
      confirmText: t("modTemplates.deleteConfirm"),
      cancelText: t("common:actions.cancel"),
    });
    if (ok) remove.mutate();
  }

  /**
   * Put a variable where the cursor is. ⚠ Only a FOCUSED field has a cursor worth
   * using: an untouched textarea reports 0, which stacked variables in front of the
   * message. Unfocused, it appends.
   */
  function insert(token: string) {
    const el = textRef.current;
    const focused = !!el && document.activeElement === el;
    const at = focused ? el.selectionStart : draft.text.length;
    const end = focused ? el.selectionEnd : at;
    set("text", draft.text.slice(0, at) + token + draft.text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  }

  const dur: Duration = draft.defaultDuration ?? "7d";
  const vars = {
    user: t("modTemplates.sample.user"),
    type: t("modTemplates.sample.type"),
    where: t("modTemplates.sample.where"),
    duration: DURATION_TEXT[dur],
  };
  const varKeys = draft.mode === "ban" ? ["user", "type", "where", "duration"] : ["user", "type", "where"];

  return (
    <div className="mtp-form">
      <div className="mtp-form__title">
        <h2>{draft.name || t("modTemplates.untitled")}</h2>
        {template.isDefault && <span className="mtp-badge">{t("modTemplates.default")}</span>}
        <span className="mtp-gap" />
        <button type="button" className="btn-ghost btn-sm" onClick={onDuplicate}><FontAwesomeIcon icon={faCopy} /> {t("modTemplates.duplicate")}</button>
        <button type="button" className="btn-ghost btn-sm" disabled={remove.isPending} onClick={confirmDelete}><FontAwesomeIcon icon={faTrash} /> {t("modTemplates.delete")}</button>
      </div>

      <div className="mtp-fields">
        <label>
          <span className="mtp-label">{t("modTemplates.name")}</span>
          <input className="inp" value={draft.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          <span className="mtp-label">{t("modTemplates.rule")}</span>
          <input className="inp" value={draft.ruleRef} maxLength={80} placeholder={t("modTemplates.rulePlaceholder")} onChange={(e) => set("ruleRef", e.target.value)} />
        </label>
      </div>

      <div>
        <span className="mtp-label">{t("modTemplates.usedFor")}</span>
        <div className="acp-seg">
          {MODES.map((m) => (
            <button key={m} type="button" className={draft.mode === m ? "is-on" : ""}
              onClick={() => setDraft((d) => ({ ...d, mode: m, defaultDuration: m === "ban" ? (d.defaultDuration ?? "7d") : null }))}>
              {t(`modTemplates.mode.${m}`)}
            </button>
          ))}
        </div>
        <p className="mtp-hint">{t(`modTemplates.modeHint.${draft.mode}`)}</p>
      </div>

      {draft.mode === "ban" && (
        <div>
          <span className="mtp-label">{t("modTemplates.defaultDuration")}</span>
          <div className="acp-seg">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={dur === d ? "is-on" : ""} onClick={() => set("defaultDuration", d)}>
                {d === "perm" ? t("modTemplates.permanent") : DURATION_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className="mtp-label">{t("modTemplates.message")}</span>
        <textarea ref={textRef} className="inp mtp-textarea" value={draft.text} maxLength={2000} rows={5}
          onChange={(e) => set("text", e.target.value)} />
        <div className="mtp-vars">
          {varKeys.map((v) => (
            <button key={v} type="button" className="mtp-var" onClick={() => insert(`{${v}}`)}>
              <code>{`{${v}}`}</code><span>{t(`modTemplates.var.${v}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <label>
        <span className="mtp-label">{t("modTemplates.match")}</span>
        <input className="inp" value={draft.matchCategories} placeholder={t("modTemplates.matchPlaceholder")}
          onChange={(e) => set("matchCategories", e.target.value)} />
        <p className="mtp-hint">{t("modTemplates.matchHint")}</p>
      </label>

      <div>
        <span className="mtp-label">{t("modTemplates.preview")}</span>
        <div className="mtp-preview">
          <div className="mtp-preview__ic"><FontAwesomeIcon icon={faShieldHalved} /></div>
          <div>
            <b>{t(`modTemplates.previewTitle.${draft.mode}`)}</b>
            <p>{fillSegments(draft.text, vars).map((s, i) => s.filled ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}</p>
          </div>
        </div>
      </div>

      <p className="mtp-muted">
        {t("modTemplates.used", { count: template.useCount })}
        {template.updatedBy ? ` · ${t("modTemplates.edited", { name: template.updatedBy, when: timeAgo(template.updatedAt) })}` : ""}
      </p>
    </div>
  );
}
