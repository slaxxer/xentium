import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { JSONContent } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faImage, faGlobe, faLock, faKey, faChevronLeft, faSliders, faFloppyDisk,
  faTriangleExclamation, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  articlesApi,
  articleCategoriesApi,
  type ArticleVisibility,
  type CreateArticleInput,
  type ArticleDetail,
} from "../../lib/articlesApi";
import { Composer } from "../../components/composer/Composer";
import { Avatar } from "../../components/Avatar";
import { authStore, userCan } from "../../lib/authStore";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import { apiErrorMessage } from "../../lib/swal";
import { toast } from "../../lib/toast";
import { openDialog } from "../../lib/dialog";
import "./components/ArticleEditor.scss";
import "./ArticleEditorPage.scss";
import { useDateTime } from "../../lib/datetime";

const EMPTY_BODY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * ⚠ The article body is stored as ProseMirror JSON and drawn by the reader with
 * `RICH_EXTENSIONS` (ArticleContent). The composer brings the shared set; this adds
 * the one node articles have that it lacks. Without it, opening an imported article
 * that carries images would silently drop them on the next save.
 */
const ARTICLE_EXTENSIONS = [Image.configure({ inline: false, HTMLAttributes: { class: "article-editor__image" } })];

const PUBLISH_MIN_WORDS = 10;
const EXCERPT_SOFT_MAX = 160;

/** May edit someone else's article — the key the update endpoint checks. */
function viewerIsStaff(user: Parameters<typeof userCan>[0]): boolean {
  return userCan(user, "article.edit.any");
}

/**
 * Draft or published — the two states the server can hold. The old editor also
 * offered "Review", which set nothing: the update endpoint accepts no status, and a
 * button that looks like it works and does not is worse than no button.
 */
type Status = "draft" | "published";

interface FormState {
  title: string;
  excerpt: string;
  body: JSONContent;
  categoryId: string;
  tags: string[];
  tagInput: string;
  visibility: ArticleVisibility;
  seoTitle: string;
  seoDescription: string;
}

const emptyForm: FormState = {
  title: "", excerpt: "", body: EMPTY_BODY, categoryId: "", tags: [], tagInput: "",
  visibility: "public", seoTitle: "", seoDescription: "",
};

function fromDetail(d: ArticleDetail): FormState {
  return {
    title: d.title,
    excerpt: d.excerpt ?? "",
    body: (d.body as JSONContent) ?? EMPTY_BODY,
    categoryId: d.category?.id ?? "",
    tags: d.tags.map((t) => t.name),
    tagInput: "",
    visibility: d.visibility,
    seoTitle: d.seoTitle ?? "",
    seoDescription: d.seoDescription ?? "",
  };
}

function toInput(form: FormState): CreateArticleInput {
  return {
    title: form.title.trim(),
    body: form.body,
    excerpt: form.excerpt.trim() || undefined,
    categoryId: form.categoryId || undefined,
    tags: form.tags,
    visibility: form.visibility,
    seoTitle: form.seoTitle.trim() || undefined,
    seoDescription: form.seoDescription.trim() || undefined,
  };
}

function bodyText(json: unknown): string {
  const text: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (typeof node.text === "string") text.push(node.text);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c as { text?: string; content?: unknown[] });
  };
  if (json && typeof json === "object") walk(json as { text?: string; content?: unknown[] });
  return text.join(" ");
}
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A field-level note about what publishing still needs. */
function Need({ children }: { children: React.ReactNode }) {
  return (
    <div className="aed-need">
      <FontAwesomeIcon className="aed-need__ic" icon={faTriangleExclamation} />
      <span>{children}</span>
    </div>
  );
}

export function ArticleEditorPage() {
  const { t } = useTranslation("articles");
  const dt = useDateTime();
  const { slug } = useParams<{ slug?: string }>();
  const isEdit = !!slug;
  const navigate = useNavigate();
  const qc = useQueryClient();

  // SEO preview host comes from the configured site URL, not a hardcoded domain.
  const { data: siteCfg } = useSiteConfig();
  let seoHost = "yoursite.com";
  try { if (siteCfg?.siteUrl) seoHost = new URL(siteCfg.siteUrl).host; } catch { /* keep fallback */ }

  const existingQuery = useQuery({
    queryKey: ["article", slug],
    queryFn: () => articlesApi.getBySlug(slug!),
    enabled: isEdit,
  });
  const categoriesQuery = useQuery({
    queryKey: ["article-categories"],
    queryFn: () => articleCategoriesApi.tree(),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [status, setStatus] = useState<Status>("draft");
  const [featuredUrl, setFeaturedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Open beside the canvas where there is room for both; a slide-over below that.
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1280);
  const [localSavedAt, setLocalSavedAt] = useState<number | null>(null);
  const [serverSavedAt, setServerSavedAt] = useState<number | null>(null);
  // Warnings wait until the writer has had a go, or asked to publish.
  const [triedPublish, setTriedPublish] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Local draft — stable for the lifetime of this editor session ─────────
  const draftKey = `aep_draft_${slug ?? "new"}`;
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDraft = useCallback(() => {
    // Cancel any pending auto-save so it cannot re-write the draft after we clear it
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setLocalSavedAt(null);
  }, [draftKey]);

  /**
   * What the server holds, as text. The local autosave compares against it and stays
   * quiet when nothing changed.
   *
   * ⚠ Without this, the first save moved the route from /articles/new to
   * /articles/<slug>/edit, the same component stayed mounted, the draft key changed
   * with the route, and three seconds later the UNCHANGED article was written to local
   * storage under the new key — newer than the server's copy, so the next visit asked
   * to restore an "unsaved draft" of exactly what had just been saved.
   */
  const savedSnap = useRef<string | null>(null);
  const snapshot = (f: FormState, cover: string | null) => JSON.stringify({ f: { ...f, tagInput: "" }, cover });

  const text = useMemo(() => bodyText(form.body), [form.body]);
  const words = countWords(text);
  const chars = text.length;
  const hasContent = !!form.title.trim() || words >= 3;

  // Keep refs so beforeunload always has the latest values without re-registering
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const featuredUrlRef = useRef(featuredUrl);
  useEffect(() => { featuredUrlRef.current = featuredUrl; }, [featuredUrl]);

  // Save to localStorage immediately before the tab/window closes
  useEffect(() => {
    const saveNow = () => {
      const f = formRef.current;
      if (!f.title.trim() && countWords(bodyText(f.body)) < 3) return;
      if (snapshot(f, featuredUrlRef.current) === savedSnap.current) return; // nothing unsaved
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form: f, featuredUrl: featuredUrlRef.current, savedAt: Date.now() }));
      } catch { /* storage quota exceeded */ }
    };
    window.addEventListener("beforeunload", saveNow);
    return () => window.removeEventListener("beforeunload", saveNow);
  }, [draftKey]);

  // Debounced auto-save every 3 s while typing (min 3 words of content)
  useEffect(() => {
    if (!hasContent) return;
    if (snapshot(form, featuredUrl) === savedSnap.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(draftKey, JSON.stringify({ form, featuredUrl, savedAt }));
        setLocalSavedAt(savedAt);
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [form, featuredUrl, draftKey, hasContent]);

  // ── Load server article + offer draft restore once data is ready ──────────
  const draftOfferedRef = useRef(false);

  useEffect(() => {
    if (isEdit && !existingQuery.data) return; // wait for article to load
    if (draftOfferedRef.current) return;
    draftOfferedRef.current = true;

    if (existingQuery.data) {
      const loaded = fromDetail(existingQuery.data);
      const cover = existingQuery.data.featuredImage ? `/uploads/${existingQuery.data.featuredImage}` : null;
      savedSnap.current = snapshot(loaded, cover);
      setForm(loaded);
      setStatus(existingQuery.data.status === "published" ? "published" : "draft");
      setFeaturedUrl(existingQuery.data.featuredImage ? `/uploads/${existingQuery.data.featuredImage}` : null);
      setServerSavedAt(new Date(existingQuery.data.updatedAt).getTime());
    }

    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved: { form: FormState; featuredUrl?: string | null; savedAt: number } = JSON.parse(raw);

      // For edit mode: skip if the draft predates the last server save
      if (existingQuery.data?.updatedAt) {
        const serverMs = new Date(existingQuery.data.updatedAt).getTime();
        if (saved.savedAt <= serverMs) { clearDraft(); return; }
      }

      const when = dt.stamp(saved.savedAt);
      void openDialog({
        kind: "confirm", icon: "question",
        title: t("editor.draftFoundTitle"), body: t("editor.draftFoundBody", { when }),
        confirmText: t("editor.restore"), cancelText: t("editor.discard"),
      }).then((ok) => {
        if (ok) {
          setForm(saved.form);
          setLocalSavedAt(saved.savedAt);
          // Only apply the draft's featuredUrl if it was explicitly saved (key present).
          // Old drafts lack the key; without this guard they'd wipe a server-loaded image.
          if ("featuredUrl" in saved) setFeaturedUrl(saved.featuredUrl ?? null);
        } else {
          clearDraft();
        }
      });
    } catch {
      clearDraft();
    }
  }, [existingQuery.data, isEdit, draftKey, clearDraft, t]);

  const articleId = existingQuery.data?.id;
  const viewerId = authStore.user?.id;
  const isOwner = !!existingQuery.data && existingQuery.data.author.id === viewerId;
  const isStaff = viewerIsStaff(authStore.user);
  const canEditThisArticle = !isEdit || isOwner || isStaff;

  const afterSave = (article: ArticleDetail) => {
    savedSnap.current = snapshot(formRef.current, featuredUrlRef.current);
    clearDraft();
    setServerSavedAt(Date.now());
    qc.setQueryData(["article", article.slug], article);
    void qc.invalidateQueries({ queryKey: ["articles"] });
    void qc.invalidateQueries({ queryKey: ["articles-drafts-check"] });
  };

  /** Save current form state. Creates a new draft or updates existing. */
  const saveMut = useMutation({
    mutationFn: async (): Promise<ArticleDetail> =>
      articleId ? articlesApi.update(articleId, toInput(form)) : articlesApi.create(toInput(form)),
    onSuccess: (article) => {
      afterSave(article);
      setStatus(article.status === "published" ? "published" : "draft");
      toast.success(t("editor.savedToast"));
      if (article.slug !== slug) navigate(`/articles/${article.slug}/edit`, { replace: true });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("editor.saveError"))),
  });

  /** Save (create-or-update) then publish. */
  const publishMut = useMutation({
    mutationFn: async (): Promise<ArticleDetail> => {
      const saved = articleId
        ? await articlesApi.update(articleId, toInput(form))
        : await articlesApi.create(toInput(form));
      return articlesApi.publish(saved.id);
    },
    onSuccess: (article) => {
      afterSave(article);
      navigate(`/articles/${article.slug}`, { replace: true });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("editor.publishError"))),
  });

  const unpublishMut = useMutation({
    mutationFn: async (): Promise<ArticleDetail> => {
      await articlesApi.update(articleId!, toInput(form));
      return articlesApi.unpublish(articleId!);
    },
    onSuccess: (article) => {
      afterSave(article);
      setStatus("draft");
      toast.success(t("editor.unpublishedToast"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("editor.saveError"))),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File): Promise<{ article: ArticleDetail; url: string }> => {
      let id = articleId;
      if (!id) {
        const draft = await articlesApi.create(toInput(form));
        id = draft.id;
        qc.setQueryData(["article", draft.slug], draft);
        if (draft.slug !== slug) navigate(`/articles/${draft.slug}/edit`, { replace: true });
      }
      return articlesApi.uploadFeaturedImage(id, file);
    },
    onSuccess: ({ article, url }) => {
      savedSnap.current = snapshot(formRef.current, url);
      setFeaturedUrl(url);
      setServerSavedAt(Date.now());
      qc.setQueryData(["article", article.slug], article);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("editor.uploadFailed"))),
  });

  // ── What publishing still needs — shown beside each field, never as a popup ──
  const titleOk = form.title.trim().length >= 3;
  const need = {
    title:    !titleOk,
    excerpt:  !form.excerpt.trim(),
    body:     words < PUBLISH_MIN_WORDS,
    category: !form.categoryId,
    tags:     form.tags.length === 0,
    image:    !featuredUrl,
  };
  const missing = Object.values(need).filter(Boolean).length;
  const panelMissing = [need.category, need.tags, need.image].filter(Boolean).length;
  const canPublish = missing === 0;
  // Once there is a title, the rest of the list is worth showing; until then it is noise.
  const warn = triedPublish || titleOk;

  const handleSave = () => {
    if (!titleOk) { setTriedPublish(true); return; }
    saveMut.mutate();
  };
  const handlePublish = () => {
    setTriedPublish(true);
    if (!canPublish) {
      if (need.category || need.tags || need.image) setPanelOpen(true);
      return;
    }
    publishMut.mutate();
  };
  const handleStatus = async (next: Status) => {
    if (next === status) return;
    if (next === "published") { handlePublish(); return; }
    const ok = await openDialog({
      kind: "confirm", icon: "warning", title: t("editor.unpublishTitle"), body: t("editor.unpublishBody"),
      confirmText: t("editor.unpublish"), cancelText: t("editor.cancel"),
    });
    if (ok) unpublishMut.mutate();
  };

  const handleFileSelected = (file: File | null) => {
    if (!file) return;
    if (!titleOk) { setTriedPublish(true); toast.info(t("editor.errTitleBeforeImage")); return; }
    uploadMut.mutate(file);
  };
  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFileSelected(e.dataTransfer.files?.[0] ?? null);
  };

  const addTag = () => {
    const tag = form.tagInput.trim().replace(/^#/, "");
    if (!tag || form.tags.includes(tag)) { setForm((f) => ({ ...f, tagInput: "" })); return; }
    setForm((f) => ({ ...f, tags: [...f.tags, tag], tagInput: "" }));
  };
  const removeTag = (tag: string) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }));

  const isBusy = saveMut.isPending || publishMut.isPending || unpublishMut.isPending;
  const user = authStore.user;
  const userName = user?.username ?? "You";
  const onBodyJson = useCallback((json: JSONContent) => setForm((f) => ({ ...f, body: json })), []);

  const publishLabel = status === "published"
    ? (publishMut.isPending ? t("editor.updating") : t("editor.update"))
    : (publishMut.isPending ? t("editor.publishing") : t("editor.publish"));
  const saveChip = isBusy ? { dot: "busy", label: t("editor.saving") }
    : localSavedAt && (!serverSavedAt || localSavedAt > serverSavedAt) ? { dot: "ok", label: t("editor.chipLocal") }
    : serverSavedAt ? { dot: "ok", label: status === "published" ? t("editor.chipPublished") : t("editor.chipSaved") }
    : { dot: "idle", label: hasContent ? t("editor.chipUnsaved") : t("editor.chipEmpty") };
  const countLine = `${t("editor.wordsN", { n: words })} · ${t("editor.charsN", { n: chars })}`;
  const publishTitle = canPublish ? t("editor.publishTooltip") : t("editor.stillNeeded", { count: missing });

  // Editing an article you don't own and aren't staff for — bounce to the
  // reader. The backend would refuse the save anyway (XEC-PERM-1001); this
  // just stops you from seeing the editor chrome.
  if (isEdit && existingQuery.data && !canEditThisArticle) {
    return <Navigate to={`/articles/${existingQuery.data.slug}`} replace />;
  }

  return (
    <div className="aed">
      {/* ── Top bar: where you are, whether it is safe, and the two actions ── */}
      <div className="aed-top">
        <Link to={articleId && status === "published" ? `/articles/${slug}` : "/articles"} className="aed-top__back" aria-label={t("editor.back")}>
          <FontAwesomeIcon icon={faChevronLeft} />
        </Link>
        <div className="aed-top__crumb">
          <span>{t("editor.crumbArticles")}</span>
          <span className="aed-top__sep">/</span>
          <b>{form.title.trim() || t("editor.newArticle")}</b>
        </div>
        <span className={`aed-chip aed-chip--${saveChip.dot}`}><i />{saveChip.label}</span>
        <span className="aed-top__gap" />
        <span className="aed-top__count">{countLine}</span>
        <button type="button" className={`aed-btn aed-btn--details${panelOpen ? " is-on" : ""}`} onClick={() => setPanelOpen((o) => !o)}>
          <FontAwesomeIcon icon={faSliders} />
          <span>{t("editor.details")}</span>
          {warn && panelMissing > 0 && <span className="aed-btn__n">{panelMissing}</span>}
        </button>
        <button type="button" className="aed-btn aed-btn--ghost" onClick={handleSave} disabled={isBusy}>
          <FontAwesomeIcon icon={faFloppyDisk} />{t("editor.saveDraft")}
        </button>
        <button type="button" className={`aed-btn aed-btn--primary${canPublish ? "" : " is-blocked"}`}
          onClick={handlePublish} disabled={isBusy} title={publishTitle} aria-disabled={!canPublish}>
          {publishLabel}<span className="aed-btn__kbd">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl↵"}</span>
        </button>
      </div>

      <div className="aed-stage">
        {/* ── Canvas ─────────────────────────────────────────────────────────── */}
        <div className="aed-canvas">
          <div className="aed-canvas__in">
            <input className="aed-title" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t("editor.titlePlaceholder")} maxLength={200} />
            {(triedPublish || form.title.length > 0) && need.title && <Need>{t("editor.needTitle")}</Need>}

            <div className="aed-byline">
              <Avatar user={{ username: userName, avatar: user?.avatar ?? null }} size={28} />
              <span className="aed-byline__name" style={user?.visibleGroups[0]?.badgeColor ? { color: user.visibleGroups[0].badgeColor } : undefined}>{userName}</span>
              <span className="aed-byline__status">{t(`editor.status.${status}`)}</span>
              <span>·</span>
              <span>{serverSavedAt ? t("editor.savedAt", { when: dt.time(serverSavedAt) }) : t("editor.newDraft")}</span>
            </div>

            <div className="aed-field">
              <div className="aed-field__head">
                <span className="aed-label">{t("editor.excerpt")}</span>
                <span className="aed-field__hint">{t("editor.excerptHint")}</span>
                <span className="aed-top__gap" />
                <span className={`aed-field__count${form.excerpt.length > EXCERPT_SOFT_MAX ? " is-over" : ""}`}>{form.excerpt.length}/{EXCERPT_SOFT_MAX}</span>
              </div>
              <textarea className={`aed-excerpt${warn && need.excerpt ? " is-needed" : ""}`} rows={2} maxLength={500}
                value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder={t("editor.excerptPlaceholder")} />
              {warn && need.excerpt && <Need>{t("editor.needExcerpt")}</Need>}
            </div>

            <div className="aed-body">
              <Composer
                variant="panel"
                toolbarPosition="top"
                minHeight={420}
                mentions={false}
                extraExtensions={ARTICLE_EXTENSIONS}
                surface="article"
                initialJson={form.body}
                onChangeJson={onBodyJson}
                placeholder={t("editor.bodyPlaceholder")}
                submitInBar={false}
                onSubmit={handlePublish}
                disabled={isBusy}
              />
            </div>
            {warn && need.body && (
              <Need>{words === 0 ? t("editor.needBodyEmpty", { n: PUBLISH_MIN_WORDS }) : t("editor.needBodyMore", { count: PUBLISH_MIN_WORDS - words })}</Need>
            )}
          </div>
        </div>

        {/* ── Details: a slide-over, so the canvas keeps the full width ─────── */}
        {panelOpen && <div className="aed-scrim" onClick={() => setPanelOpen(false)} />}
        <aside className={`aed-panel${panelOpen ? " is-open" : ""}`} aria-hidden={!panelOpen}>
          <div className="aed-panel__head">
            <b>{t("editor.detailsTitle")}</b>
            {warn && panelMissing > 0 && <span className="aed-panel__need">{t("editor.toFill", { count: panelMissing })}</span>}
            <span className="aed-top__gap" />
            <button type="button" className="aed-panel__x" onClick={() => setPanelOpen(false)} aria-label={t("editor.close")}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="aed-panel__body">
            <div className="aed-label">{t("editor.statusLabel")}</div>
            <div className="aed-seg">
              {(["draft", "published"] as Status[]).map((s) => (
                <button key={s} type="button" className={status === s ? "is-on" : ""}
                  disabled={isBusy || (s === "draft" && !articleId)} onClick={() => void handleStatus(s)}>
                  {t(`editor.status.${s}`)}
                </button>
              ))}
            </div>

            <div className="aed-rule" />

            <div className="aed-label">{t("editor.category")}</div>
            <select className={`aed-input${warn && need.category ? " is-needed" : ""}`} value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">{t("editor.chooseCategory")}</option>
              {categoriesQuery.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {warn && need.category && <Need>{t("editor.needCategory")}</Need>}

            <div className="aed-label aed-label--gap">{t("editor.tags")}</div>
            {form.tags.length > 0 && (
              <div className="aed-tags">
                {form.tags.map((tag) => (
                  <button key={tag} type="button" className="aed-tag" onClick={() => removeTag(tag)} title={t("editor.removeTag")}>
                    #{tag}<FontAwesomeIcon className="aed-tag__x" icon={faXmark} />
                  </button>
                ))}
              </div>
            )}
            <input className={`aed-input${warn && need.tags ? " is-needed" : ""}`} value={form.tagInput}
              onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
              onBlur={addTag} placeholder={t("editor.addTagHint")} maxLength={40} />
            {warn && need.tags && <Need>{t("editor.needTags")}</Need>}

            <div className="aed-rule" />

            <div className="aed-label">{t("editor.featuredImage")}</div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden
              onChange={(e) => { handleFileSelected(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {featuredUrl ? (
              <div className="aed-cover">
                <img className="aed-cover__img" src={featuredUrl} alt={t("editor.featuredAlt")} />
                <div className="aed-cover__row">
                  <span>{uploadMut.isPending ? t("editor.uploading") : t("editor.coverSet")}</span>
                  <button type="button" className="aed-btn aed-btn--ghost aed-btn--sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMut.isPending}>
                    {t("editor.replace")}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button"
                className={`aed-drop${dragging ? " is-dragging" : ""}${uploadMut.isPending ? " is-busy" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}>
                <FontAwesomeIcon className="aed-drop__ic" icon={faImage} />
                <span className="aed-drop__t">{uploadMut.isPending ? t("editor.uploading") : t("editor.dropImage")}</span>
                <span className="aed-drop__s">{t("editor.imageTypes")}</span>
              </button>
            )}
            {warn && need.image && <Need>{t("editor.needImage")}</Need>}

            <div className="aed-rule" />

            <div className="aed-label">{t("editor.visibility")}</div>
            {([
              [faGlobe, "public", "visPublic", "visPublicHint"],
              [faLock, "members", "visMembers", "visMembersHint"],
              [faKey, "private", "visPrivate", "visPrivateHint"],
            ] as [typeof faGlobe, ArticleVisibility, string, string][]).map(([icon, val, labelKey, hintKey]) => (
              <button key={val} type="button" role="radio" aria-checked={form.visibility === val}
                className={`aed-vis${form.visibility === val ? " is-on" : ""}`}
                onClick={() => setForm({ ...form, visibility: val })}>
                <FontAwesomeIcon className="aed-vis__ic" icon={icon} />
                <span className="aed-vis__label">{t(`editor.${labelKey}`)}</span>
                <span className="aed-vis__hint">{t(`editor.${hintKey}`)}</span>
              </button>
            ))}

            <div className="aed-rule" />

            <div className="aed-label">{t("editor.searchAppearance")}</div>
            <div className="aed-seo">
              <div className="aed-seo__host">{seoHost} › articles</div>
              <div className="aed-seo__title">{form.seoTitle.trim() || form.title.trim() || t("editor.seoTitleFallback")}</div>
              <div className="aed-seo__desc">{form.seoDescription.trim() || form.excerpt.trim() || t("editor.seoDescFallback")}</div>
            </div>
            <input className="aed-input aed-input--mt" value={form.seoTitle} maxLength={200}
              onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} placeholder={t("editor.seoTitlePlaceholder")} />
            <textarea className="aed-input aed-input--mt" rows={2} value={form.seoDescription} maxLength={500}
              onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} placeholder={t("editor.seoDescPlaceholder")} />
          </div>

          <div className="aed-panel__foot">
            <button type="button" className="aed-btn aed-btn--ghost" onClick={handleSave} disabled={isBusy}>{t("editor.saveDraft")}</button>
            <span className="aed-top__gap" />
            <button type="button" className={`aed-btn aed-btn--primary${canPublish ? "" : " is-blocked"}`}
              onClick={handlePublish} disabled={isBusy} title={publishTitle} aria-disabled={!canPublish}>{publishLabel}</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
