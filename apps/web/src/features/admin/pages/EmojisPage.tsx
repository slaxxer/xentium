/**
 * ACP → Content → Emojis — the emojis the editor's picker offers, everywhere the
 * Composer is used (articles, comments, the wall, forum posts, messages).
 *
 * One card per category, one dense row per emoji, in the order the picker shows them:
 * drag a row (or Alt + ↑/↓ on its handle) to reorder, and drop it into another card to
 * move it there. Uploading stages a batch above the list: the shortcodes come from the
 * file names, and clashes (with an emoji that exists or another file in the batch)
 * are marked before anything is sent. No search box, by the admin's choice.
 *
 * ⚠ "Remove" RETIRES an emoji: it leaves the picker, but posts that used it keep
 * showing it, because a post stores the image itself. The file and the row stay, and
 * the shortcode stays taken (it is still the alt text in those posts).
 *
 * Not a draft page: each upload, edit, move and removal is a deliberate act and
 * happens on its own, the documented exception to the save bar.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emojiShortcodeSchema, shortcodeFromFilename, type EmojiRow } from "@xentium/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { AcpIcon } from "./acpIcons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faGripVertical, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import "./EmojisPage.scss";

const QUERY_KEY = ["acp-emojis"] as const;
const ACCEPT = "image/png,image/gif,image/webp";

interface Pending { key: string; file: File; preview: string; shortcode: string; name: string; error?: string }

const validCode = (code: string) => emojiShortcodeSchema.safeParse(code).success;

export function EmojisPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [pendingCategory, setPendingCategory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The row being dragged, and where it would land: before `beforeId` in `category` (null = at the end). */
  const [drag, setDrag] = useState<{ id: string; category: string; beforeId: string | null } | null>(null);

  const { data: emojis = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<EmojiRow[]>("/admin/emojis"),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    // The picker everywhere reads the public list.
    qc.invalidateQueries({ queryKey: ["emojis"] });
  };

  const categories = useMemo(() => [...new Set(emojis.map((e) => e.category).filter(Boolean))], [emojis]);
  const groups = useMemo(() => {
    const m = new Map<string, EmojiRow[]>();
    for (const e of emojis) m.set(e.category, [...(m.get(e.category) ?? []), e]);
    return m;
  }, [emojis]);

  const choose = (list: FileList | null) => {
    // ⚠ Copied NOW: the FileList is live, and the input is cleared right after this
    // call — by the time React runs the updater below it would be empty.
    const files = list ? [...list] : [];
    if (!files.length) return;
    // Built here, not inside a state updater: it numbers clashes by mutating a set,
    // and React may run an updater twice (StrictMode), which turned `sunny` into
    // `sunny_2` against its own first run.
    const taken = new Set([...emojis.map((e) => e.shortcode), ...pending.map((p) => p.shortcode)]);
    const added = files.map((file, i) => {
      let code = shortcodeFromFilename(file.name) || `emoji_${Date.now().toString(36)}${i}`;
      // Two files called the same, or a name already used: number the rest.
      let n = 2; const base = code;
      while (taken.has(code)) code = `${base}_${n++}`.slice(0, 32);
      taken.add(code);
      return { key: `${file.name}:${file.size}:${i}:${Date.now()}`, file, preview: URL.createObjectURL(file), shortcode: code, name: "" };
    });
    setPending((prev) => [...prev, ...added]);
  };

  /** What is wrong with a staged row before it is sent: its form, or a clash. */
  const clash = (p: Pending): string | undefined => {
    if (!validCode(p.shortcode)) return t("emojis.errInvalid");
    if (emojis.some((e) => e.shortcode === p.shortcode)) return t("emojis.errTaken", { code: p.shortcode });
    if (pending.filter((x) => x.shortcode === p.shortcode).length > 1) return t("emojis.errTwice", { code: p.shortcode });
    return undefined;
  };
  // A server refusal (e.g. a shortcode a RETIRED emoji keeps) shows too, until edited.
  const problem = (p: Pending) => clash(p) ?? p.error;

  const upload = useMutation({
    mutationFn: async () => {
      const failed: Pending[] = [];
      for (const p of pending) {
        const fd = new FormData();
        fd.append("file", p.file);
        fd.append("shortcode", p.shortcode);
        if (p.name.trim()) fd.append("name", p.name.trim());
        if (pendingCategory.trim()) fd.append("category", pendingCategory.trim());
        try {
          await api.post("/admin/emojis", fd);
          URL.revokeObjectURL(p.preview);
        } catch (e) {
          failed.push({ ...p, error: apiErrorMessage(e) });
        }
      }
      return { added: pending.length - failed.length, failed };
    },
    onSuccess: ({ added, failed }) => {
      setPending(failed);
      refresh();
      if (added) toast.success(t("emojis.added", { count: added }));
      if (failed.length) toast.error(t("emojis.someFailed", { count: failed.length }));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/emojis/${id}`),
    onSuccess: () => { refresh(); toast.success(t("emojis.removed")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const reorder = useMutation({
    mutationFn: (v: { category: string; ids: string[] }) => api.put<EmojiRow[]>("/admin/emojis/order", v),
    // Shown at once; the server's answer replaces it, a failure puts the old order back.
    onMutate: ({ category, ids }) => {
      const before = qc.getQueryData<EmojiRow[]>(QUERY_KEY);
      if (before) {
        const pos = new Map(ids.map((id, i) => [id, i]));
        qc.setQueryData<EmojiRow[]>(QUERY_KEY, before.map((e) => pos.has(e.id) ? { ...e, category, position: pos.get(e.id)! } : e)
          .sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position));
      }
      return { before };
    },
    onSuccess: (rows) => { qc.setQueryData(QUERY_KEY, rows); qc.invalidateQueries({ queryKey: ["emojis"] }); },
    onError: (e, _v, ctx) => { if (ctx?.before) qc.setQueryData(QUERY_KEY, ctx.before); toast.error(apiErrorMessage(e)); },
  });

  /** Put `id` into `category` before `beforeId` (null = last), and save that card's order. */
  const move = (id: string, category: string, beforeId: string | null) => {
    if (id === beforeId) return;
    const ids = (groups.get(category) ?? []).map((e) => e.id).filter((x) => x !== id);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(at < 0 ? ids.length : at, 0, id);
    const current = (groups.get(category) ?? []).map((e) => e.id);
    if (current.join() === ids.join()) return;
    reorder.mutate({ category, ids });
  };

  /** Alt + ↑/↓ on a handle: the keyboard way to drag, within the card. */
  const nudge = (e: EmojiRow, dir: -1 | 1) => {
    const list = groups.get(e.category) ?? [];
    const i = list.findIndex((x) => x.id === e.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate({ category: e.category, ids });
  };

  const confirmRemove = async (e: EmojiRow) => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("emojis.removeTitle", { code: e.shortcode }),
      body: t("emojis.removeBody"),
      confirmText: t("emojis.remove"),
    });
    if (ok) remove.mutate(e.id);
  };

  const pendingValid = pending.length > 0 && pending.every((p) => !clash(p));

  return (
    <div className="emj-page">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.content")}</p>
          <h1 className="pg-title">{t("emojis.title")} <span className="emj-active">{t("emojis.active", { count: emojis.length })}</span></h1>
          <p className="pg-sub">{t("emojis.subtitle")}</p>
        </div>
        <div className="emj-headside">
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
            <AcpIcon name="plus" size={15} /><span>{t("emojis.upload")}</span>
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
            onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {pending.length > 0 && (
        <section className="emj-card emj-batch">
          <div className="emj-batch__head">
            <div>
              <h2>{t("emojis.pendingTitle", { count: pending.length })}</h2>
              <p>{t("emojis.pendingSub")}</p>
            </div>
            <label className="emj-field emj-batch__cat">
              <span>{t("emojis.categoryAll")}</span>
              <input className="inp inp--sm" list="emj-categories" value={pendingCategory}
                placeholder={t("emojis.categoryPlaceholder")} maxLength={40}
                onChange={(e) => setPendingCategory(e.target.value)} />
            </label>
          </div>
          <div className="emj-batch__list">
            {pending.map((p) => {
              const err = problem(p);
              return (
                <div key={p.key} className={`emj-batch__row${err ? " has-error" : ""}`}>
                  <img src={p.preview} alt="" />
                  <label className={`emj-code${err ? " is-invalid" : ""}`}>
                    <span aria-hidden>:</span>
                    <input value={p.shortcode} maxLength={32} aria-label={t("emojis.shortcode")}
                      onChange={(e) => setPending((all) => all.map((x) => x.key === p.key ? { ...x, shortcode: e.target.value.toLowerCase(), error: undefined } : x))} />
                    <span aria-hidden>:</span>
                  </label>
                  <input className="inp inp--sm" value={p.name} maxLength={60} placeholder={p.shortcode} aria-label={t("emojis.name")}
                    onChange={(e) => setPending((all) => all.map((x) => x.key === p.key ? { ...x, name: e.target.value } : x))} />
                  <button type="button" className="emj-x" aria-label={t("emojis.discard")} title={t("emojis.discard")}
                    onClick={() => { URL.revokeObjectURL(p.preview); setPending((all) => all.filter((x) => x.key !== p.key)); }}>
                    <AcpIcon name="x" size={13} />
                  </button>
                  {err && <p className="emj-batch__error">{err}</p>}
                </div>
              );
            })}
          </div>
          <div className="emj-batch__foot">
            <p className="acp-hint">{t("emojis.rules")}</p>
            <button type="button" className="btn-ghost" disabled={upload.isPending}
              onClick={() => { pending.forEach((p) => URL.revokeObjectURL(p.preview)); setPending([]); }}>{t("emojis.cancel")}</button>
            <button type="button" className="btn-primary" disabled={!pendingValid || upload.isPending} onClick={() => upload.mutate()}>
              {upload.isPending ? t("emojis.adding") : t("emojis.add", { count: pending.length })}
            </button>
          </div>
        </section>
      )}
      <datalist id="emj-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      {!isLoading && emojis.length === 0 && pending.length === 0 && (
        <div className="emj-empty">
          <p>{t("emojis.empty")}</p>
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>{t("emojis.upload")}</button>
        </div>
      )}

      {[...groups.entries()].map(([category, list]) => (
        <section key={category || "_"}
          className={`emj-card emj-group${drag && drag.category === category ? " is-target" : ""}`}
          // Over the card but not a row (its header, its padding): the end of this card.
          // Rows stop the event and say exactly where.
          onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.category !== category) setDrag({ ...drag, category, beforeId: null }); }}
          onDrop={(e) => { e.preventDefault(); if (drag) move(drag.id, category, drag.beforeId); setDrag(null); }}>
          <header className="emj-group__head">
            {renaming === category
              ? <RenameCategory from={category} onDone={() => { setRenaming(null); refresh(); }} />
              : (
                <>
                  <h2>{category || t("emojis.uncategorised")} <span>{list.length}</span></h2>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setRenaming(category)}>{t("emojis.rename")}</button>
                </>
              )}
          </header>
          <ul className="emj-rows">
            {list.map((e) => editing === e.id
              ? <EmojiEditor key={e.id} emoji={e} onDone={() => { setEditing(null); refresh(); }} />
              : (
                <li key={e.id}
                  className={`emj-row${drag?.id === e.id ? " is-dragging" : ""}${drag && drag.beforeId === e.id && drag.id !== e.id ? " is-drop-before" : ""}`}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); setDrag({ id: e.id, category, beforeId: e.id }); }}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(ev) => {
                    if (!drag) return;
                    ev.preventDefault(); ev.stopPropagation();
                    // Upper half: before this row; lower half: before the next one.
                    const r = ev.currentTarget.getBoundingClientRect();
                    const after = ev.clientY > r.top + r.height / 2;
                    const next = after ? (list[list.indexOf(e) + 1]?.id ?? null) : e.id;
                    if (drag.category !== category || drag.beforeId !== next) setDrag({ ...drag, category, beforeId: next });
                  }}>
                  <button type="button" className="emj-row__grip" aria-label={t("emojis.dragHint")} title={t("emojis.dragHint")}
                    onKeyDown={(ev) => {
                      if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
                      ev.preventDefault(); nudge(e, ev.key === "ArrowUp" ? -1 : 1);
                    }}>
                    <FontAwesomeIcon icon={faGripVertical} />
                  </button>
                  <img src={e.url} alt="" loading="lazy" />
                  <code>:{e.shortcode}:</code>
                  <span className="emj-row__name">{e.name}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(e.id)}>{t("emojis.edit")}</button>
                  <button type="button" className="emj-row__remove" aria-label={t("emojis.removeTitle", { code: e.shortcode })}
                    title={t("emojis.remove")} onClick={() => confirmRemove(e)} disabled={remove.isPending}>
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RenameCategory({ from, onDone }: { from: string; onDone: () => void }) {
  const { t } = useTranslation("acp");
  const [to, setTo] = useState(from);
  const save = useMutation({
    mutationFn: () => api.post("/admin/emojis/categories/rename", { from, to }),
    onSuccess: () => { toast.success(t("emojis.renamed")); onDone(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <form className="emj-rename" onSubmit={(e) => { e.preventDefault(); if (to.trim() === from) onDone(); else save.mutate(); }}>
      <input className="inp inp--sm" value={to} maxLength={40} autoFocus list="emj-categories"
        aria-label={t("emojis.category")} placeholder={t("emojis.uncategorised")} onChange={(e) => setTo(e.target.value)} />
      <button type="button" className="btn-ghost btn-sm" onClick={onDone}>{t("emojis.cancel")}</button>
      <button type="submit" className="btn-primary btn-sm" disabled={save.isPending}>{t("emojis.save")}</button>
    </form>
  );
}

function EmojiEditor({ emoji, onDone }: { emoji: EmojiRow; onDone: () => void }) {
  const { t } = useTranslation("acp");
  const [shortcode, setShortcode] = useState(emoji.shortcode);
  const [name, setName] = useState(emoji.name);
  const [category, setCategory] = useState(emoji.category);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/emojis/${emoji.id}`, { shortcode, name, category }),
    onSuccess: () => { toast.success(t("emojis.saved")); onDone(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <li className="emj-row emj-row--edit">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <img src={emoji.url} alt="" />
        <label className={`emj-code${validCode(shortcode) ? "" : " is-invalid"}`}>
          <span aria-hidden>:</span>
          <input value={shortcode} maxLength={32} aria-label={t("emojis.shortcode")} autoFocus
            onChange={(e) => setShortcode(e.target.value.toLowerCase())} />
          <span aria-hidden>:</span>
        </label>
        <input className="inp inp--sm" value={name} maxLength={60} aria-label={t("emojis.name")} placeholder={t("emojis.name")}
          onChange={(e) => setName(e.target.value)} />
        <input className="inp inp--sm" list="emj-categories" value={category} maxLength={40}
          aria-label={t("emojis.category")} placeholder={t("emojis.category")} onChange={(e) => setCategory(e.target.value)} />
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>{t("emojis.cancel")}</button>
        <button type="submit" className="btn-primary btn-sm" disabled={!validCode(shortcode) || save.isPending}>{t("emojis.save")}</button>
      </form>
    </li>
  );
}
