import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faPlus, faCopy, faTrash, faShieldHalved, faRotateLeft, faXmark,
  faTriangleExclamation, faBan, faEraser, faInbox,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/time";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { sameValue, useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import {
  DEFAULT_WARN_EXPIRY, DURATIONS, DURATION_LABEL, DURATION_TEXT, MODES, WARN_EXPIRIES, fillSegments, warnExpiryLabel,
  type Duration, type Mode, type Template, type WarnExpiry,
} from "../../modcp/modTemplates";
import "./ModTemplatesPage.scss";

/**
 * ACP → Moderation → Templates.
 *
 * The texts moderators warn, ban, remove and dismiss with in ModCanvas; warnings and
 * bans go out exactly as written here, for as long as set here. Admins write their
 * own or keep the default set; ModCanvas only READS them. "Restore defaults" brings
 * back any that were deleted without touching the ones an admin reworded.
 *
 * Layout (concept "3a"): a board, one column per action, one card per template;
 * a card opens the editor as a drawer on the right (`?id=` in the URL, Escape or ×
 * closes it). No search box: the board shows everything at once.
 */

type AdminTemplate = Template & { isDefault: boolean };

interface Draft {
  mode: Mode; name: string; text: string; ruleRef: string;
  defaultDuration: Duration | null; warnExpiry: WarnExpiry | null; matchCategories: string;
}
const draftOf = (t: Template): Draft => ({
  mode: t.mode, name: t.name, text: t.text, ruleRef: t.ruleRef ?? "",
  defaultDuration: t.mode === "ban" ? (t.defaultDuration ?? "7d") : null,
  warnExpiry: t.mode === "warn" ? (t.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
  matchCategories: t.matchCategories.join(", "),
});
const payloadOf = (d: Draft) => ({
  mode: d.mode, name: d.name.trim() || "Untitled", text: d.text.trim() || "…", ruleRef: d.ruleRef.trim() || null,
  defaultDuration: d.mode === "ban" ? (d.defaultDuration ?? "7d") : null,
  warnExpiry: d.mode === "warn" ? (d.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
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
  /**
   * Edited templates, by id — every one, not just the open one: opening another
   * template is not leaving the page, so an unsaved edit must survive it. The save
   * bar saves them all.
   */
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const selected = params.get("id");
  const select = (id: string | null) => setParams((p) => { if (id) p.set("id", id); else p.delete("id"); return p; }, { replace: true });
  const current = templates.find((x) => x.id === selected) ?? null;

  // Escape closes the drawer.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") select(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ModCanvas reads the same texts; keep its copy in step with every change here.
  const touched = () => qc.invalidateQueries({ queryKey: ["mod-templates"] });

  /** What the server has for every template being edited — the draft's baseline. */
  const saved = useMemo(() => {
    if (isLoading) return undefined;
    return Object.fromEntries(Object.keys(edits).flatMap((id) => {
      const tpl = templates.find((x) => x.id === id);
      return tpl ? [[id, draftOf(tpl)]] : [];
    }));
  }, [templates, edits, isLoading]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dropEdit = (id: string) => setEdits((p) => { const { [id]: _gone, ...rest } = p; return rest; });

  const saveAll = useMutation({
    mutationFn: (changed: Array<[string, Draft]>) => Promise.all(changed.map(([id, d]) =>
      api.patch<Template>(`/admin/mod-templates/${id}`, payloadOf(d)))),
    onSuccess: (rows) => {
      qc.setQueryData<AdminTemplate[]>(KEY, (old) => (old ?? []).map((x) => {
        const row = rows.find((r) => r.id === x.id);
        return row ? { ...x, ...row } : x;
      }));
      // The server tidies what it stores (trimmed, defaults filled): start those
      // templates over from what it kept.
      setEdits((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !rows.some((r) => r.id === id))));
      touched();
    },
  });

  useAutosave({
    // Compared as what would be SENT, so trailing spaces alone are not a change.
    value: Object.fromEntries(Object.entries(edits).map(([id, d]) => [id, payloadOf(d)])),
    savedValue: saved && Object.fromEntries(Object.entries(saved).map(([id, d]) => [id, payloadOf(d)])),
    onSave: () => {
      const changed = Object.entries(edits).filter(([id, d]) => savedRef.current?.[id] && !sameValue(payloadOf(d), payloadOf(savedRef.current[id]!)));
      return changed.length ? saveAll.mutateAsync(changed) : undefined;
    },
    onDiscard: () => setEdits({}),
    describe: (value, base) => Object.keys(value)
      .filter((id) => !sameValue(value[id], base[id]))
      .map((id) => ({
        key: id,
        label: edits[id]?.name || t("modTemplates.untitled"),
        section: t("modTemplates.title"),
        from: base[id]?.name ?? "",
        to: value[id]!.name,
        revert: () => dropEdit(id),
      })),
  });

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

  /** A card shows the template as edited, so the board never disagrees with the drawer. */
  const view = (x: AdminTemplate): AdminTemplate => {
    const d = edits[x.id];
    if (!d) return x;
    return { ...x, ...payloadOf(d), ruleRef: d.ruleRef.trim() || null } as AdminTemplate;
  };

  return (
    <div className="mtp">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("modTemplates.eyebrow")}</p>
          <h1 className="pg-title">{t("modTemplates.title")}</h1>
          <p className="pg-sub">{t("modTemplates.sub")}</p>
        </div>
        <div className="mtp-head-side">
          <button type="button" className="btn-ghost btn-sm" disabled={restore.isPending} onClick={confirmRestore}>
            <FontAwesomeIcon icon={faRotateLeft} /> {t("modTemplates.restore")}
          </button>
          <SaveChip saving={saveAll.isPending} />
        </div>
      </div>

      {isLoading && <p className="mtp-muted">{t("sidebar.loading")}</p>}

      <div className={`mtp-board${current ? " has-drawer" : ""}`}>
        {MODES.map((mode) => {
          const items = templates.filter((x) => (edits[x.id]?.mode ?? x.mode) === mode).map(view);
          return (
            <section key={mode} className={`mtp-col mtp-col--${mode}`}>
              <header className="mtp-col__head">
                <span className="mtp-col__ic"><FontAwesomeIcon icon={MODE_ICON[mode]} /></span>
                <h2>{t(`modTemplates.group.${mode}`)}</h2>
                <span className="mtp-col__n">{items.length}</span>
              </header>
              {items.map((x) => (
                <button key={x.id} type="button" className={`mtp-card${current?.id === x.id ? " is-on" : ""}`}
                  aria-pressed={current?.id === x.id} onClick={() => select(current?.id === x.id ? null : x.id)}>
                  <b className="mtp-card__name">{x.name || t("modTemplates.untitled")}</b>
                  <span className="mtp-card__text">{x.text}</span>
                  <span className="mtp-card__foot">
                    <span>{cardMeta(x, t)}</span>
                    <span>{x.useCount}×</span>
                  </span>
                </button>
              ))}
              <button type="button" className="mtp-add" disabled={create.isPending}
                onClick={() => create.mutate({ mode, name: t("modTemplates.newName"), text: t("modTemplates.newText") })}>
                <FontAwesomeIcon icon={faPlus} /> {t("modTemplates.add")}
              </button>
            </section>
          );
        })}
      </div>

      {current && (
        <>
          <div className="mtp-scrim" onClick={() => select(null)} aria-hidden />
          <aside className="mtp-drawer" role="dialog" aria-label={current.name}>
            <Editor
              key={current.id}
              template={current}
              draft={edits[current.id] ?? draftOf(current)}
              onDraft={(d) => setEdits((p) => ({ ...p, [current.id]: d }))}
              onChanged={touched}
              onClose={() => select(null)}
              onDuplicate={() => create.mutate({ ...payloadOf(edits[current.id] ?? draftOf(current)), name: t("modTemplates.copyName", { name: current.name }) })}
              onDeleted={() => { dropEdit(current.id); select(null); touched(); }}
            />
          </aside>
        </>
      )}
    </div>
  );
}

const MODE_ICON: Record<Mode, IconDefinition> = {
  warn: faTriangleExclamation, ban: faBan, delete: faEraser, dismiss: faInbox,
};

type T = (key: string, opts?: Record<string, unknown>) => string;

/** A card's one-line summary: how long it lasts, or what kind of note it is. */
function cardMeta(x: Template, t: T): string {
  if (x.mode === "warn") return t("modTemplates.warnLen", { len: warnExpiryLabel(t, x.warnExpiry) });
  if (x.mode === "ban") return x.defaultDuration === "perm" ? t("modTemplates.permanent") : t("modTemplates.defaultLen", { len: DURATION_LABEL[x.defaultDuration ?? "7d"] });
  if (x.internal || x.mode === "dismiss") return t("modTemplates.internal");
  return x.ruleRef ?? t("modTemplates.noRule");
}

/** One template's form, in the drawer. Its edits are the PAGE's (`draft` / `onDraft`), so they survive opening another template. */
function Editor({ template, draft, onDraft, onClose, onDuplicate, onDeleted }: {
  template: AdminTemplate;
  draft: Draft;
  onDraft: (next: Draft) => void;
  onChanged: () => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onDraft({ ...draft, [k]: v });

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
      <header className={`mtp-form__head mtp-col--${draft.mode}`}>
        <span className="mtp-col__ic"><FontAwesomeIcon icon={MODE_ICON[draft.mode]} /></span>
        <input className="mtp-form__name" value={draft.name} maxLength={80} aria-label={t("modTemplates.name")}
          placeholder={t("modTemplates.untitled")} onChange={(e) => set("name", e.target.value)} />
        {template.isDefault && <span className="mtp-badge">{t("modTemplates.default")}</span>}
        <button type="button" className="mtp-form__close" aria-label={t("modTemplates.close")} onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </header>

      <div className="mtp-form__body">
        <div>
          <span className="mtp-label">{t("modTemplates.usedFor")}</span>
          <div className="acp-seg">
            {MODES.map((m) => (
              <button key={m} type="button" className={draft.mode === m ? "is-on" : ""}
                onClick={() => onDraft({
                  ...draft, mode: m,
                  defaultDuration: m === "ban" ? (draft.defaultDuration ?? "7d") : null,
                  warnExpiry: m === "warn" ? (draft.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
                })}>
                {t(`modTemplates.mode.${m}`)}
              </button>
            ))}
          </div>
          <p className="mtp-hint">{t(`modTemplates.modeHint.${draft.mode}`)}</p>
        </div>

        {draft.mode === "warn" && (
          <div>
            <span className="mtp-label">{t("modTiming.label", { ns: "common" })}</span>
            <div className="mtp-chips">
              {WARN_EXPIRIES.map((e) => (
                <button key={e} type="button" className={(draft.warnExpiry ?? DEFAULT_WARN_EXPIRY) === e ? "is-on" : ""} onClick={() => set("warnExpiry", e)}>
                  {warnExpiryLabel(t, e)}
                </button>
              ))}
            </div>
            <p className="mtp-hint">{t("modTiming.fixed", { ns: "common" })}</p>
          </div>
        )}

        {draft.mode === "ban" && (
          <div>
            <span className="mtp-label">{t("modTemplates.defaultDuration")}</span>
            <div className="mtp-chips">
              {DURATIONS.map((d) => (
                <button key={d} type="button" className={dur === d ? "is-on" : ""} onClick={() => set("defaultDuration", d)}>
                  {d === "perm" ? t("modTemplates.permanent") : DURATION_LABEL[d]}
                </button>
              ))}
            </div>
            <p className="mtp-hint">{t("modTiming.fixed", { ns: "common" })}</p>
          </div>
        )}

        <div>
          <span className="mtp-label">{t("modTemplates.message")}</span>
          <textarea ref={textRef} className="inp mtp-textarea" value={draft.text} maxLength={2000} rows={5}
            onChange={(e) => set("text", e.target.value)} />
          <div className="mtp-vars">
            {varKeys.map((v) => (
              <button key={v} type="button" className="mtp-var" title={t(`modTemplates.var.${v}`)} onClick={() => insert(`{${v}}`)}>
                <code>{`{${v}}`}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="mtp-preview">
          <div className="mtp-preview__ic"><FontAwesomeIcon icon={faShieldHalved} /></div>
          <div>
            <b>{t(`modTemplates.previewTitle.${draft.mode}`)}</b>
            <p>{fillSegments(draft.text, vars).map((s, i) => s.filled ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}</p>
          </div>
        </div>

        <label>
          <span className="mtp-label">{t("modTemplates.rule")}</span>
          <input className="inp" value={draft.ruleRef} maxLength={80} placeholder={t("modTemplates.rulePlaceholder")} onChange={(e) => set("ruleRef", e.target.value)} />
        </label>

        <label>
          <span className="mtp-label">{t("modTemplates.match")}</span>
          <input className="inp" value={draft.matchCategories} placeholder={t("modTemplates.matchPlaceholder")}
            onChange={(e) => set("matchCategories", e.target.value)} />
          <p className="mtp-hint">{t("modTemplates.matchHint")}</p>
        </label>
      </div>

      <footer className="mtp-form__foot">
        <span className="mtp-muted">
          {t("modTemplates.used", { count: template.useCount })}
          {template.updatedBy ? ` · ${t("modTemplates.edited", { name: template.updatedBy, when: timeAgo(template.updatedAt) })}` : ""}
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={onDuplicate}><FontAwesomeIcon icon={faCopy} /> {t("modTemplates.duplicate")}</button>
        <button type="button" className="btn-ghost btn-sm mtp-danger" disabled={remove.isPending} onClick={confirmDelete}><FontAwesomeIcon icon={faTrash} /> {t("modTemplates.delete")}</button>
      </footer>
    </div>
  );
}
