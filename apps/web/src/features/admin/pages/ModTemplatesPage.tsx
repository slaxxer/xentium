import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faPlus, faCopy, faTrash, faShieldHalved, faRotateLeft, faXmark, faChevronRight, faChevronLeft,
  faTriangleExclamation, faBan, faEraser, faInbox, faGripVertical, faMagnifyingGlass, faChartSimple,
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
 * bans go out exactly as written here, for as long as set here. ModCanvas only READS
 * them. "Restore defaults" brings back any that were deleted without touching the
 * ones an admin reworded.
 *
 * Layout (concept "2b, escalation path"): a tab per action, that action's templates
 * as cards on the left (search, "Manual" order by drag or "Most used"), and the open
 * template's editor on the right. The editor's ESCALATION PATH shows the warnings and
 * bans that share a trigger word with it, mildest first: that is what ModCanvas
 * suggests for the same kind of report, so it is where "what happens next time" is
 * decided. Selection and tab live in the URL (`?tab=`, `?id=`).
 *
 * Edits are drafts on the ACP save bar; creating, duplicating, deleting and ordering
 * are immediate (they are not edits of a template's text).
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
const wordsOf = (s: string) => s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
const payloadOf = (d: Draft) => ({
  mode: d.mode, name: d.name.trim() || "Untitled", text: d.text.trim() || "…", ruleRef: d.ruleRef.trim() || null,
  defaultDuration: d.mode === "ban" ? (d.defaultDuration ?? "7d") : null,
  warnExpiry: d.mode === "warn" ? (d.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
  matchCategories: wordsOf(d.matchCategories),
});

const KEY = ["acp-mod-templates"] as const;
const MODE_ICON: Record<Mode, IconDefinition> = {
  warn: faTriangleExclamation, ban: faBan, delete: faEraser, dismiss: faInbox,
};
/** Mildest first: a warning comes before a ban on the escalation path. */
const MILD: Record<Mode, number> = { dismiss: 0, warn: 1, delete: 2, ban: 3 };
const DUR_RANK: Record<Duration, number> = { "1h": 1, "24h": 2, "7d": 3, "30d": 4, perm: 5 };
const MAX_TEXT = 2000;

type T = (key: string, opts?: Record<string, unknown>) => string;

/** How long a template lasts, as one phrase ("Counts for 30 days", "Permanent ban"). */
function lengthOf(x: Pick<Template, "mode" | "warnExpiry" | "defaultDuration">, t: T): string {
  if (x.mode === "warn") return t("modTemplates.warnLen", { len: warnExpiryLabel(t, x.warnExpiry) });
  if (x.mode === "ban") return x.defaultDuration === "perm" ? t("modTemplates.permanentBan") : t("modTemplates.banLen", { len: DURATION_TEXT[x.defaultDuration ?? "7d"] });
  if (x.mode === "dismiss") return t("modTemplates.internal");
  return "";
}

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"manual" | "usage">("manual");
  const [dragId, setDragId] = useState<string | null>(null);

  const tabParam = params.get("tab") as Mode | null;
  const tab: Mode = tabParam && MODES.includes(tabParam) ? tabParam : "warn";
  const selected = params.get("id");
  const go = (next: { tab?: Mode; id?: string | null }) => setParams((p) => {
    if (next.tab) p.set("tab", next.tab);
    if (next.id === null) p.delete("id"); else if (next.id) p.set("id", next.id);
    return p;
  }, { replace: true });

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
      setQuery("");
      go({ tab: row.mode, id: row.id });
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

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put("/admin/mod-templates/order", { ids }),
    onSuccess: () => touched(),
    onError: (e) => { toast.error(apiErrorMessage(e)); qc.invalidateQueries({ queryKey: KEY }); },
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

  /** A template as edited, so the list, the path and the editor never disagree. */
  const view = (x: AdminTemplate): AdminTemplate => {
    const d = edits[x.id];
    if (!d) return x;
    return { ...x, ...payloadOf(d), ruleRef: d.ruleRef.trim() || null } as AdminTemplate;
  };
  const all = templates.map(view);
  const counts = Object.fromEntries(MODES.map((m) => [m, all.filter((x) => x.mode === m).length])) as Record<Mode, number>;

  const q = query.trim().toLowerCase();
  const inTab = all.filter((x) => x.mode === tab);
  const ordered = sort === "usage" ? [...inTab].sort((a, b) => b.useCount - a.useCount) : inTab;
  const list = ordered.filter((x) => !q || `${x.name} ${x.text} ${x.matchCategories.join(" ")}`.toLowerCase().includes(q));
  const canDrag = sort === "manual" && !q;

  const current = all.find((x) => x.id === selected) ?? null;
  const wide = useWide();
  useEffect(() => {
    if (isLoading) return;
    // The open template decides the tab (its action may just have been changed).
    if (current) { if (current.mode !== tab) go({ tab: current.mode }); return; }
    // Side by side, an empty editor is wasted space: open the tab's first template.
    // Stacked (phone), the list IS the view until one is picked.
    const first = all.find((x) => x.mode === tab);
    if (wide && first) go({ id: first.id });
  }, [isLoading, tab, current?.id, current?.mode, wide]);

  /** Drop `from` onto `to`'s place within this tab, then store the tab's new order. */
  function drop(from: string, to: string) {
    if (from === to) return;
    const ids = inTab.map((x) => x.id);
    const i = ids.indexOf(from), j = ids.indexOf(to);
    if (i < 0 || j < 0) return;
    ids.splice(i, 1);
    ids.splice(i < j ? ids.indexOf(to) + 1 : ids.indexOf(to), 0, from);
    qc.setQueryData<AdminTemplate[]>(KEY, (old) => {
      const rest = (old ?? []).filter((x) => !ids.includes(x.id));
      const byId = new Map((old ?? []).map((x) => [x.id, x]));
      return [...rest, ...ids.map((id) => byId.get(id)!).filter(Boolean)];
    });
    reorder.mutate(ids);
  }

  const startText = (mode: Mode) => t(`modTemplates.startText.${mode}`);
  const addOne = (mode: Mode) => create.mutate({ mode, name: t(`modTemplates.newOf.${mode}`), text: startText(mode) });

  return (
    <div className={`mtp${current ? " has-open" : ""}`}>
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

      <div className="mtp-tabs" role="tablist" aria-label={t("modTemplates.title")}>
        {MODES.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={tab === m}
            className={`mtp-tab mtp-tone--${m}${tab === m ? " is-on" : ""}`}
            onClick={() => { setQuery(""); go({ tab: m, id: all.find((x) => x.mode === m)?.id ?? null }); }}>
            <span className="mtp-chip"><FontAwesomeIcon icon={MODE_ICON[m]} /></span>
            <span className="mtp-tab__label">{t(`modTemplates.tab.${m}`)}</span>
            <span className="mtp-tab__n">{counts[m]}</span>
          </button>
        ))}
      </div>

      {isLoading && <p className="mtp-muted">{t("sidebar.loading")}</p>}

      <div className="mtp-split">
        <section className="mtp-list" aria-label={t(`modTemplates.tab.${tab}`)}>
          <div className="mtp-list__bar">
            <label className="mtp-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("modTemplates.search")} aria-label={t("modTemplates.search")} />
            </label>
            <div className="mtp-seg" role="group" aria-label={t("modTemplates.sortLabel")}>
              {(["manual", "usage"] as const).map((s) => (
                <button key={s} type="button" className={sort === s ? "is-on" : ""} aria-pressed={sort === s} onClick={() => setSort(s)}>
                  {t(`modTemplates.sort.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="mtp-cards">
            {list.map((x) => {
              const on = current?.id === x.id;
              const len = lengthOf(x, t);
              return (
                <div
                  key={x.id}
                  className={`mtp-card${on ? " is-on" : ""}${dragId === x.id ? " is-dragging" : ""}`}
                  draggable={canDrag}
                  onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = "move"; setDragId(x.id); }}
                  onDragOver={(e: DragEvent) => { if (canDrag) e.preventDefault(); }}
                  onDrop={(e: DragEvent) => { e.preventDefault(); if (dragId) drop(dragId, x.id); setDragId(null); }}
                  onDragEnd={() => setDragId(null)}
                >
                  <button type="button" className="mtp-card__hit" aria-pressed={on} onClick={() => go({ id: x.id })}>
                    <span className="mtp-card__head">
                      {canDrag && <span className="mtp-card__grip" title={t("modTemplates.dragHint")}><FontAwesomeIcon icon={faGripVertical} /></span>}
                      <b className="mtp-card__name">{x.name || t("modTemplates.untitled")}</b>
                      <span className="mtp-card__uses">{t("modTemplates.usedShort", { count: x.useCount })}</span>
                    </span>
                    <span className="mtp-card__text"><Tokens text={x.text} /></span>
                    {(len || x.ruleRef || x.matchCategories.length > 0) && (
                      <span className="mtp-card__tags">
                        {len && <span className="mtp-pill">{len}</span>}
                        {x.ruleRef && <span className="mtp-pill">{x.ruleRef}</span>}
                        {x.matchCategories.slice(0, 4).map((w) => <span key={w} className="mtp-pill mtp-pill--word">{w}</span>)}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
            {list.length === 0 && !isLoading && <p className="mtp-muted mtp-cards__empty">{q ? t("modTemplates.nothing") : t("modTemplates.empty")}</p>}
            <button type="button" className="mtp-add" disabled={create.isPending} onClick={() => addOne(tab)}>
              <FontAwesomeIcon icon={faPlus} /> {t(`modTemplates.newOf.${tab}`)}
            </button>
          </div>
        </section>

        <section className="mtp-editor" aria-label={current?.name ?? t("modTemplates.title")}>
          {!current ? (
            <div className="mtp-editor__none">{t("modTemplates.pick")}</div>
          ) : (
            <Editor
              key={current.id}
              template={templates.find((x) => x.id === current.id)!}
              all={all}
              draft={edits[current.id] ?? draftOf(templates.find((x) => x.id === current.id)!)}
              onDraft={(d) => {
                setEdits((p) => ({ ...p, [current.id]: d }));
                // Changing the action moves the template to that tab.
                if (d.mode !== tab) go({ tab: d.mode });
              }}
              onOpen={(id, mode) => go({ tab: mode, id })}
              onBack={() => go({ id: null })}
              onDuplicate={() => create.mutate({
                ...payloadOf(edits[current.id] ?? draftOf(current)),
                name: t("modTemplates.copyName", { name: current.name }),
              })}
              onAddBan={() => create.mutate({
                mode: "ban",
                name: t("modTemplates.repeatName", { name: current.name }),
                text: t("modTemplates.repeatBanText"),
                matchCategories: current.matchCategories,
              })}
              onDeleted={() => { dropEdit(current.id); go({ id: all.find((x) => x.mode === current.mode && x.id !== current.id)?.id ?? null }); touched(); }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** True while the list and the editor sit side by side (must match the stylesheet's breakpoint). */
function useWide(): boolean {
  const query = "(min-width: 1100px)";
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** A message with its `{variables}` picked out, as on the cards. */
function Tokens({ text }: { text: string }) {
  return <>{text.split(/(\{\w+\})/).filter(Boolean).map((p, i) => /^\{\w+\}$/.test(p) ? <code key={i}>{p}</code> : <span key={i}>{p}</span>)}</>;
}

/** One template's editor. Its edits are the PAGE's (`draft` / `onDraft`), so they survive opening another template. */
function Editor({ template, all, draft, onDraft, onOpen, onBack, onDuplicate, onAddBan, onDeleted }: {
  template: AdminTemplate;
  all: AdminTemplate[];
  draft: Draft;
  onDraft: (next: Draft) => void;
  onOpen: (id: string, mode: Mode) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onAddBan: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [newWord, setNewWord] = useState("");
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
    setPreview(false);
    const el = textRef.current;
    const focused = !!el && document.activeElement === el;
    const at = focused ? el.selectionStart : draft.text.length;
    const end = focused ? el.selectionEnd : at;
    set("text", draft.text.slice(0, at) + token + draft.text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  }

  const words = wordsOf(draft.matchCategories);
  const setWords = (w: string[]) => set("matchCategories", w.join(", "));
  function wordKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = newWord.trim().toLowerCase();
      if (v && !words.includes(v)) setWords([...words, v]);
      setNewWord("");
    } else if (e.key === "Backspace" && !newWord && words.length) {
      setWords(words.slice(0, -1));
    }
  }

  const dur: Duration = draft.defaultDuration ?? "7d";
  const sample = t("modTemplates.sample.user");
  const vars = { user: sample, type: t("modTemplates.sample.type"), where: t("modTemplates.sample.where"), duration: DURATION_TEXT[dur] };
  const varKeys = draft.mode === "ban" ? ["user", "type", "where", "duration"] : ["user", "type", "where"];
  const me: AdminTemplate = { ...template, ...payloadOf(draft) } as AdminTemplate;
  const len = lengthOf(me, t);

  // ── The escalation path: warnings and bans sharing a trigger word, mildest first.
  const onPath = draft.mode === "warn" || draft.mode === "ban";
  const related = all.filter((y) => y.id !== template.id && (y.mode === "warn" || y.mode === "ban")
    && y.matchCategories.some((w) => words.includes(w)));
  const path = onPath
    ? [me, ...related].sort((a, b) => MILD[a.mode] - MILD[b.mode] || DUR_RANK[a.defaultDuration ?? "7d"] - DUR_RANK[b.defaultDuration ?? "7d"])
    : [];
  const canAddBan = draft.mode === "warn" && !path.some((y) => y.mode === "ban");
  const pathNote = !onPath ? t("modTemplates.pathOutside") : related.length ? t("modTemplates.pathLinked") : t("modTemplates.pathAlone");
  const stepKind = (y: AdminTemplate) => y.mode === "warn"
    ? t("modTemplates.stepWarn", { len: warnExpiryLabel(t, y.warnExpiry) })
    : y.defaultDuration === "perm" ? t("modTemplates.stepBanPerm") : t("modTemplates.stepBan", { len: DURATION_TEXT[y.defaultDuration ?? "7d"] });

  const modeTotal = all.filter((y) => y.mode === draft.mode).reduce((a, y) => a + y.useCount, 0);
  const share = modeTotal ? Math.round((template.useCount / modeTotal) * 100) : 0;

  return (
    <div className={`mtp-form mtp-tone--${draft.mode}`}>
      <header className="mtp-form__head">
        <button type="button" className="mtp-iconbtn mtp-form__back" onClick={onBack} aria-label={t("modTemplates.back")}>
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <input className="mtp-form__name" value={draft.name} maxLength={80} aria-label={t("modTemplates.name")}
          placeholder={t("modTemplates.untitled")} onChange={(e) => set("name", e.target.value)} />
        {template.isDefault && <span className="mtp-badge">{t("modTemplates.default")}</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={onDuplicate}><FontAwesomeIcon icon={faCopy} /> {t("modTemplates.duplicate")}</button>
        <button type="button" className="mtp-iconbtn mtp-iconbtn--danger" disabled={remove.isPending} onClick={confirmDelete}
          title={t("modTemplates.delete")} aria-label={t("modTemplates.delete")}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </header>

      <div className="mtp-form__scroll">
        <div className="mtp-path">
          <div className="mtp-path__head">
            <span className="mtp-caps">{t("modTemplates.pathTitle")}</span>
            <span className="mtp-path__note">{pathNote}</span>
          </div>
          {onPath && (
            <div className="mtp-path__steps">
              {path.map((y, i) => (
                <span key={y.id} className="mtp-path__stepwrap">
                  {i > 0 && <FontAwesomeIcon icon={faChevronRight} className="mtp-path__arrow" />}
                  <button type="button" className={`mtp-step mtp-tone--${y.mode}${y.id === template.id ? " is-me" : ""}`}
                    disabled={y.id === template.id} onClick={() => onOpen(y.id, y.mode)}>
                    <span className="mtp-chip"><FontAwesomeIcon icon={MODE_ICON[y.mode]} /></span>
                    <span className="mtp-step__text">
                      <b>{y.name || t("modTemplates.untitled")}</b>
                      <span>{stepKind(y)}</span>
                    </span>
                  </button>
                </span>
              ))}
              {canAddBan && (
                <span className="mtp-path__stepwrap">
                  <FontAwesomeIcon icon={faChevronRight} className="mtp-path__arrow" />
                  <button type="button" className="mtp-step mtp-step--add" onClick={onAddBan}>
                    <FontAwesomeIcon icon={faPlus} /> {t("modTemplates.addBanStep")}
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mtp-msg">
          <div className="mtp-msg__bar">
            <span className="mtp-msg__label">{t("modTemplates.message")}</span>
            <div className="mtp-seg mtp-seg--sm" role="group">
              <button type="button" className={!preview ? "is-on" : ""} aria-pressed={!preview} onClick={() => setPreview(false)}>{t("modTemplates.write")}</button>
              <button type="button" className={preview ? "is-on" : ""} aria-pressed={preview} onClick={() => setPreview(true)}>{t("modTemplates.asSeen", { user: sample })}</button>
            </div>
          </div>
          <div className="mtp-msg__box">
            <div className="mtp-msg__head">
              <span className="mtp-chip mtp-chip--lg"><FontAwesomeIcon icon={faShieldHalved} /></span>
              <b>{t(`modTemplates.previewTitle.${draft.mode}`)}</b>
              {len && draft.mode !== "dismiss" && <span className="mtp-pill">{len}</span>}
            </div>
            {!preview ? (
              <>
                <textarea ref={textRef} className="mtp-msg__text" value={draft.text} maxLength={MAX_TEXT} rows={4}
                  aria-label={t("modTemplates.message")} onChange={(e) => set("text", e.target.value)} />
                <div className="mtp-msg__vars">
                  {varKeys.map((v) => (
                    <button key={v} type="button" className="mtp-var" title={t(`modTemplates.var.${v}`)} onClick={() => insert(`{${v}}`)}>
                      <code>{`{${v}}`}</code>
                    </button>
                  ))}
                  <span className="mtp-msg__count">{draft.text.length} / {MAX_TEXT}</span>
                </div>
              </>
            ) : (
              <p className="mtp-msg__preview">
                {fillSegments(draft.text, vars).map((s, i) => s.filled ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}
              </p>
            )}
          </div>
          <p className="mtp-hint">{t(`modTemplates.modeHint.${draft.mode}`)}</p>
        </div>

        <div className="mtp-rows">
          <div className="mtp-row">
            <div><div className="mtp-row__label">{t("modTemplates.action")}</div><div className="mtp-row__desc">{t("modTemplates.actionHint")}</div></div>
            <div className="mtp-seg mtp-seg--wide" role="group" aria-label={t("modTemplates.action")}>
              {MODES.map((m) => (
                <button key={m} type="button" className={draft.mode === m ? "is-on" : ""} aria-pressed={draft.mode === m}
                  onClick={() => onDraft({
                    ...draft, mode: m,
                    defaultDuration: m === "ban" ? (draft.defaultDuration ?? "7d") : null,
                    warnExpiry: m === "warn" ? (draft.warnExpiry ?? DEFAULT_WARN_EXPIRY) : null,
                  })}>
                  {t(`modTemplates.mode.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {draft.mode === "warn" && (
            <div className="mtp-row">
              <div><div className="mtp-row__label">{t("modTiming.label", { ns: "common" })}</div><div className="mtp-row__desc">{t("modTemplates.lenHint")}</div></div>
              <div className="mtp-lens">
                {WARN_EXPIRIES.map((e) => (
                  <button key={e} type="button" className={(draft.warnExpiry ?? DEFAULT_WARN_EXPIRY) === e ? "is-on" : ""} onClick={() => set("warnExpiry", e)}>
                    {warnExpiryLabel(t, e)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.mode === "ban" && (
            <div className="mtp-row">
              <div><div className="mtp-row__label">{t("modTemplates.defaultDuration")}</div><div className="mtp-row__desc">{t("modTemplates.lenHint")}</div></div>
              <div className="mtp-lens">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" className={dur === d ? "is-on" : ""} onClick={() => set("defaultDuration", d)}>
                    {d === "perm" ? t("modTemplates.permanent") : DURATION_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mtp-row">
            <div><div className="mtp-row__label">{t("modTemplates.triggers")}</div><div className="mtp-row__desc">{t("modTemplates.triggersHint")}</div></div>
            <div className="mtp-words" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
              {words.map((w) => (
                <span key={w} className="mtp-word">
                  {w}
                  <button type="button" aria-label={t("modTemplates.removeWord", { word: w })} onClick={(e) => { e.stopPropagation(); setWords(words.filter((z) => z !== w)); }}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </span>
              ))}
              <input value={newWord} onChange={(e) => setNewWord(e.target.value)} onKeyDown={wordKey}
                onBlur={() => { const v = newWord.trim().toLowerCase(); if (v && !words.includes(v)) setWords([...words, v]); setNewWord(""); }}
                placeholder={t("modTemplates.triggerAdd")} aria-label={t("modTemplates.triggers")} />
            </div>
          </div>

          <div className="mtp-row">
            <div><div className="mtp-row__label">{t("modTemplates.rule")}</div><div className="mtp-row__desc">{t("modTemplates.ruleHint")}</div></div>
            <input className="inp" value={draft.ruleRef} maxLength={80} placeholder={t("modTemplates.rulePlaceholder")} onChange={(e) => set("ruleRef", e.target.value)} />
          </div>
        </div>
      </div>

      <footer className="mtp-form__foot">
        <span className="mtp-form__used"><FontAwesomeIcon icon={faChartSimple} /> {t("modTemplates.used", { count: template.useCount })}</span>
        {modeTotal > 0 && <span>{t(`modTemplates.share.${draft.mode}`, { pct: share })}</span>}
        {template.updatedBy && <span className="mtp-form__edited">{t("modTemplates.edited", { name: template.updatedBy, when: timeAgo(template.updatedAt) })}</span>}
      </footer>
    </div>
  );
}
