/**
 * ACP → Content → Emojis — the emojis the editor's picker offers, everywhere the
 * Composer is used (articles, comments, the wall, forum posts, messages).
 *
 * There is no built-in set: what a community can post is the community's call. An
 * admin uploads images (several at once), names each with a `:shortcode:` and a
 * category, and can rename, move or remove one.
 *
 * ⚠ "Remove" RETIRES an emoji: it leaves the picker, but posts that used it keep
 * showing it, because a post stores the image itself. The file and the row stay, and
 * the shortcode stays taken (it is still the alt text in those posts).
 *
 * Not a draft page: each upload, edit and removal is a deliberate act and happens on
 * its own button — the documented exception to the save bar.
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
import { faTrashCan } from "@fortawesome/free-solid-svg-icons";
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

  const confirmRemove = async (e: EmojiRow) => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("emojis.removeTitle", { code: e.shortcode }),
      body: t("emojis.removeBody"),
      confirmText: t("emojis.remove"),
    });
    if (ok) remove.mutate(e.id);
  };

  const groups = new Map<string, EmojiRow[]>();
  for (const e of emojis) groups.set(e.category, [...(groups.get(e.category) ?? []), e]);

  const pendingValid = pending.length > 0 && pending.every((p) => validCode(p.shortcode))
    && new Set(pending.map((p) => p.shortcode)).size === pending.length;

  return (
    <div className="emj-page" style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.content")}</p>
          <h1 className="pg-title">{t("emojis.title")}</h1>
          <p className="pg-sub">{t("emojis.subtitle")}</p>
        </div>
        <div className="emj-headside">
          <span className="emj-count"><b>{emojis.length}</b> {t("emojis.count", { count: emojis.length })}</span>
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
            <AcpIcon name="plus" size={15} /><span>{t("emojis.upload")}</span>
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
            onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {pending.length > 0 && (
        <section className="emj-pending">
          <div className="emj-pending__head">
            <h2>{t("emojis.pendingTitle", { count: pending.length })}</h2>
            <label className="emj-field">
              <span>{t("emojis.category")}</span>
              <input className="inp inp--sm" list="emj-categories" value={pendingCategory}
                placeholder={t("emojis.categoryPlaceholder")} maxLength={40}
                onChange={(e) => setPendingCategory(e.target.value)} />
            </label>
          </div>
          <div className="emj-pending__list">
            {pending.map((p) => (
              <div key={p.key} className={`emj-pending__row${p.error ? " has-error" : ""}`}>
                <img src={p.preview} alt="" />
                <label className="emj-field">
                  <span>{t("emojis.shortcode")}</span>
                  <input className={`inp inp--sm${validCode(p.shortcode) ? "" : " is-invalid"}`} value={p.shortcode} maxLength={32}
                    onChange={(e) => setPending((all) => all.map((x) => x.key === p.key ? { ...x, shortcode: e.target.value.toLowerCase(), error: undefined } : x))} />
                </label>
                <label className="emj-field">
                  <span>{t("emojis.name")}</span>
                  <input className="inp inp--sm" value={p.name} maxLength={60} placeholder={p.shortcode}
                    onChange={(e) => setPending((all) => all.map((x) => x.key === p.key ? { ...x, name: e.target.value } : x))} />
                </label>
                <button type="button" className="btn-ghost btn-sm" aria-label={t("emojis.discard")}
                  onClick={() => { URL.revokeObjectURL(p.preview); setPending((all) => all.filter((x) => x.key !== p.key)); }}>
                  <AcpIcon name="x" size={14} />
                </button>
                {p.error && <p className="emj-pending__error">{p.error}</p>}
              </div>
            ))}
          </div>
          <div className="emj-pending__foot">
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
        <section key={category || "_"} className="emj-group">
          <h2 className="emj-group__title">{category || t("emojis.uncategorised")} <span>{list.length}</span></h2>
          <div className="emj-grid">
            {list.map((e) => editing === e.id
              ? <EmojiEditor key={e.id} emoji={e} onDone={() => { setEditing(null); refresh(); }} />
              : (
                <div key={e.id} className="emj-tile">
                  <button type="button" className="emj-tile__main" title={t("emojis.edit")} onClick={() => setEditing(e.id)}>
                    <img src={e.url} alt="" loading="lazy" />
                    <code>:{e.shortcode}:</code>
                    {e.name !== e.shortcode && <span className="emj-tile__name">{e.name}</span>}
                  </button>
                  <button type="button" className="emj-tile__remove" aria-label={t("emojis.removeTitle", { code: e.shortcode })}
                    title={t("emojis.remove")} onClick={() => confirmRemove(e)} disabled={remove.isPending}>
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
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
    <form className="emj-tile emj-tile--edit" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <img src={emoji.url} alt="" />
      <input className={`inp inp--sm${validCode(shortcode) ? "" : " is-invalid"}`} value={shortcode} maxLength={32}
        aria-label={t("emojis.shortcode")} onChange={(e) => setShortcode(e.target.value.toLowerCase())} />
      <input className="inp inp--sm" value={name} maxLength={60} aria-label={t("emojis.name")} placeholder={t("emojis.name")}
        onChange={(e) => setName(e.target.value)} />
      <input className="inp inp--sm" list="emj-categories" value={category} maxLength={40}
        aria-label={t("emojis.category")} placeholder={t("emojis.category")} onChange={(e) => setCategory(e.target.value)} />
      <div className="emj-tile__actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>{t("emojis.cancel")}</button>
        <button type="submit" className="btn-primary btn-sm" disabled={!validCode(shortcode) || save.isPending}>{t("emojis.save")}</button>
      </div>
    </form>
  );
}
