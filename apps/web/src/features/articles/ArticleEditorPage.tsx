import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, useCallback } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage, faGlobe, faLock, faKey } from "@fortawesome/free-solid-svg-icons";
import {
  articlesApi,
  articleCategoriesApi,
  type ArticleVisibility,
  type CreateArticleInput,
  type ArticleDetail,
} from "../../lib/articlesApi";
import {
  useArticleEditor,
  ArticleEditorToolbar,
  ArticleEditorBody,
} from "./components/ArticleEditor";
import { authStore } from "../../lib/authStore";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import { UserAvatar } from "../../components/UserAvatar";
import { Username } from "../../components/Username";
import { swalError, swalToast, swalConfirm, apiErrorMessage } from "../../lib/swal";
import "./ArticleEditorPage.scss";

const EMPTY_BODY = { type: "doc", content: [{ type: "paragraph" }] };

const STAFF_GROUP_KEYS = new Set(["admin", "supermod", "moderator"]);

function viewerIsStaff(user: { groups?: Array<{ key: string }> } | null | undefined): boolean {
  return user?.groups?.some((g) => STAFF_GROUP_KEYS.has(g.key)) ?? false;
}

type Status = "draft" | "review" | "published";

interface FormState {
  title: string;
  excerpt: string;
  body: unknown;
  categoryId: string;
  tags: string[];
  tagInput: string;
  visibility: ArticleVisibility;
  seoTitle: string;
  seoDescription: string;
}

const emptyForm: FormState = {
  title: "",
  excerpt: "",
  body: EMPTY_BODY,
  categoryId: "",
  tags: [],
  tagInput: "",
  visibility: "public",
  seoTitle: "",
  seoDescription: "",
};

function fromDetail(d: ArticleDetail): FormState {
  return {
    title: d.title,
    excerpt: d.excerpt ?? "",
    body: d.body,
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

function wordCount(json: unknown): number {
  const text: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (typeof node.text === "string") text.push(node.text);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c as { text?: string; content?: unknown[] });
  };
  if (json && typeof json === "object") walk(json as { text?: string; content?: unknown[] });
  return text.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

export function ArticleEditorPage() {
  const { t } = useTranslation("articles");
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editor = useArticleEditor({
    value: form.body,
    onChange: (json) => setForm((f) => ({ ...f, body: json })),
  });

  // ── Draft key — stable for the lifetime of this editor session ────────────
  const draftKey = `aep_draft_${slug ?? "new"}`;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDraft = useCallback(() => {
    // Cancel any pending auto-save so it cannot re-write the draft after we clear it
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [draftKey]);

  // Keep refs so beforeunload always has the latest values without re-registering
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const featuredUrlRef = useRef(featuredUrl);
  useEffect(() => { featuredUrlRef.current = featuredUrl; }, [featuredUrl]);

  // Save to localStorage immediately before the tab/window closes
  useEffect(() => {
    const saveNow = () => {
      const f = formRef.current;
      if (!f.title.trim() && wordCount(f.body) < 3) return;
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form: f, featuredUrl: featuredUrlRef.current, savedAt: Date.now() }));
      } catch { /* storage quota exceeded */ }
    };
    window.addEventListener("beforeunload", saveNow);
    return () => window.removeEventListener("beforeunload", saveNow);
  }, [draftKey]);

  // Debounced auto-save every 3 s while typing (min 3 words of content)
  useEffect(() => {
    if (!form.title.trim() && wordCount(form.body) < 3) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ form, featuredUrl, savedAt: Date.now() }));
      } catch { /* ignore */ }
    }, 3000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [form, featuredUrl, draftKey]);

  // ── Load server article + offer draft restore once data is ready ──────────
  const draftOfferedRef = useRef(false);

  useEffect(() => {
    if (isEdit && !existingQuery.data) return; // wait for article to load
    if (draftOfferedRef.current) return;
    draftOfferedRef.current = true;

    if (existingQuery.data) {
      setForm(fromDetail(existingQuery.data));
      setStatus(existingQuery.data.status as Status);
      setFeaturedUrl(existingQuery.data.featuredImage ? `/uploads/${existingQuery.data.featuredImage}` : null);
    }

    // Check for a locally-saved draft
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved: { form: FormState; featuredUrl?: string | null; savedAt: number } = JSON.parse(raw);

      // For edit mode: skip if the draft predates the last server save
      if (existingQuery.data?.updatedAt) {
        const serverMs = new Date(existingQuery.data.updatedAt).getTime();
        if (saved.savedAt <= serverMs) { clearDraft(); return; }
      }

      const when = new Date(saved.savedAt).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });

      swalConfirm(
        t("editor.draftFoundTitle"),
        t("editor.draftFoundBody", { when }),
        t("editor.restore"),
        t("editor.discard"),
      ).then((r) => {
        if (r) {
          setForm(saved.form);
          // Only apply the draft's featuredUrl if it was explicitly saved (key present).
          // Old drafts lack the key; without this guard they'd wipe a server-loaded image.
          if ("featuredUrl" in saved) {
            setFeaturedUrl(saved.featuredUrl ?? null);
          }
        } else {
          clearDraft();
        }
      });
    } catch {
      clearDraft();
    }
  }, [existingQuery.data, isEdit, draftKey, clearDraft]);

  const articleId = existingQuery.data?.id;
  const viewerId = authStore.user?.id;
  const isOwner = !!existingQuery.data && existingQuery.data.author.id === viewerId;
  const isStaff = viewerIsStaff(authStore.user);
  const canEditThisArticle = !isEdit || isOwner || isStaff;

  /** Save current form state. Creates a new draft or updates existing. */
  const saveMut = useMutation({
    mutationFn: async (): Promise<ArticleDetail> => {
      if (articleId) return articlesApi.update(articleId, toInput(form));
      return articlesApi.create(toInput(form));
    },
    onSuccess: (article) => {
      clearDraft();
      qc.setQueryData(["article", article.slug], article);
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["articles-drafts-check"] });
      setStatus(article.status as Status);
      if (article.slug !== slug) navigate(`/articles/${article.slug}/edit`, { replace: true });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("editor.saveError"))),
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
      clearDraft();
      qc.setQueryData(["article", article.slug], article);
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["articles-drafts-check"] });
      navigate(`/articles/${article.slug}`, { replace: true });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("editor.publishError"))),
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
      setFeaturedUrl(url);
      qc.setQueryData(["article", article.slug], article);
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("editor.uploadFailed"))),
  });

  const PUBLISH_MIN_WORDS = 10;

  const validateForSave = () => {
    if (form.title.trim().length < 3) {
      swalError(t("editor.errTitle"));
      return false;
    }
    if (form.tags.length === 0) {
      swalError(t("editor.errTag"));
      return false;
    }
    if (!form.categoryId) {
      swalError(t("editor.errCategory"));
      return false;
    }
    return true;
  };

  const validateForPublish = () => {
    if (form.title.trim().length < 3) {
      swalError(t("editor.errTitle"));
      return false;
    }
    if (form.tags.length === 0) {
      swalError(t("editor.errTag"));
      return false;
    }
    if (!form.categoryId) {
      swalError(t("editor.errCategory"));
      return false;
    }
    if (!featuredUrl) {
      swalError(t("editor.errImage"));
      return false;
    }
    if (!form.excerpt.trim()) {
      swalError(t("editor.errExcerpt"));
      return false;
    }
    if (wordCount(form.body) < PUBLISH_MIN_WORDS) {
      swalError(t("editor.errBody", { n: PUBLISH_MIN_WORDS }));
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!validateForSave()) return;
    saveMut.mutate();
  };

  const handlePublish = () => {
    if (!validateForPublish()) return;
    publishMut.mutate();
  };

  const handleFileSelected = (file: File | null) => {
    if (!file) return;
    if (form.title.trim().length < 3) {
      swalError(t("editor.errTitleBeforeImage"));
      return;
    }
    uploadMut.mutate(file);
  };

  const canPublish =
    form.title.trim().length >= 3 &&
    form.tags.length > 0 &&
    !!form.categoryId &&
    !!featuredUrl &&
    form.excerpt.trim().length > 0 &&
    wordCount(form.body) >= PUBLISH_MIN_WORDS;

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFileSelected(file ?? null);
  };

  const addTag = () => {
    const t = form.tagInput.trim();
    if (!t || form.tags.includes(t)) return;
    setForm((f) => ({ ...f, tags: [...f.tags, t], tagInput: "" }));
  };
  const removeTag = (t: string) =>
    setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }));

  const isBusy = saveMut.isPending || publishMut.isPending;
  const words = wordCount(form.body);
  const userName = authStore.user?.username ?? authStore.user?.id ?? "You";

  const publishLabel =
    status === "published"
      ? publishMut.isPending ? t("editor.updating") : t("editor.update")
      : publishMut.isPending ? t("editor.publishing") : t("editor.publish");

  // Editing an article you don't own and aren't staff for — bounce to the
  // reader. The backend would refuse the save anyway (NEC-PERM-1001); this
  // just stops you from seeing the editor chrome.
  if (isEdit && existingQuery.data && !canEditThisArticle) {
    return <Navigate to={`/articles/${existingQuery.data.slug}`} replace />;
  }

  return (
    <div className="aep">
      <div className="aep__main">
        <ArticleEditorToolbar
          editor={editor}
          rightSlot={`${t("editor.wordsN", { n: words })} · ${isBusy ? t("editor.saving") : articleId ? t("editor.autoSaved") : t("editor.draftStatus")}`}
        />
        <div className="aep__canvas">
          <div className="aep__canvas-inner">
            <input
              className="aep__title-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t("editor.titlePlaceholder")}
            />

            <div className="aep__byline">
              <UserAvatar
                user={{ username: userName, avatar: authStore.user?.avatar ?? null }}
                size={32}
                className="aep__avatar"
              />
              <span>
                <Username
                  username={userName}
                  badgeColor={authStore.user?.groups[0]?.badgeColor}
                /> · {t(`editor.status.${status}`)} ·{" "}
                {isBusy ? t("editor.saving") : articleId ? t("editor.savedJustNow") : t("editor.newDraft")}
              </span>
            </div>

            <textarea
              className="aep__excerpt-input"
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              placeholder={t("editor.excerptPlaceholder")}
              rows={2}
            />

            <ArticleEditorBody editor={editor} placeholder={t("editor.bodyPlaceholder")} />
          </div>
        </div>
      </div>

      <aside className="aep__sidebar">
        <div className="aep__section">
          <div className="aep__label">{t("editor.statusLabel")}</div>
          <div className="aep__status-row">
            {(["draft", "review", "published"] as Status[]).map((s) => (
              <button
                key={s}
                className={`aep__status-btn ${status === s ? "is-active" : ""}`}
                onClick={() => setStatus(s)}
                type="button"
              >
                {t(`editor.status.${s}`)}
              </button>
            ))}
          </div>

          <button
            className="aep__btn aep__btn--primary"
            disabled={publishMut.isPending || !canPublish}
            onClick={handlePublish}
            type="button"
            title={canPublish ? t("editor.publishTooltip") : t("editor.publishTooltipDisabled")}
          >
            {publishLabel}
          </button>
          <button
            className="aep__btn aep__btn--ghost"
            onClick={handleSave}
            disabled={saveMut.isPending || form.title.trim().length < 3 || form.tags.length === 0 || !form.categoryId}
            type="button"
          >
            {saveMut.isPending ? t("editor.saving") : t("editor.saveDraft")}
          </button>
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("editor.category")}</div>
          <select
            className="aep__select"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">{t("editor.none")}</option>
            {categoriesQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="aep__section">
          <div className="aep__label">{t("editor.tags")}</div>
          <div className="aep__chips">
            {form.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="aep__chip"
                onClick={() => removeTag(tag)}
                title={t("editor.removeTag")}
              >
                #{tag} ✕
              </button>
            ))}
          </div>
          <input
            className="aep__input"
            value={form.tagInput}
            onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder={t("editor.addTag")}
          />
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("editor.featuredImage")}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
          />
          <div
            className={`aep__dropzone ${dragging ? "is-dragging" : ""} ${uploadMut.isPending ? "is-busy" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {featuredUrl ? (
              <>
                <img className="aep__dropzone-preview" src={featuredUrl} alt={t("editor.featuredAlt")} />
                <div className="aep__dropzone-text">
                  {uploadMut.isPending ? t("editor.uploading") : t("editor.replaceImage")}
                </div>
              </>
            ) : (
              <>
                <div className="aep__dropzone-icon"><FontAwesomeIcon icon={faImage} /></div>
                <div className="aep__dropzone-text">
                  {uploadMut.isPending ? t("editor.uploading") : t("editor.dropImage")}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("editor.visibility")}</div>
          {([
            [faGlobe, "public", "visPublic"],
            [faLock, "members", "visMembers"],
            [faKey, "private", "visPrivate"],
          ] as [typeof faGlobe, ArticleVisibility, string][]).map(([icon, val, labelKey]) => (
            <label key={val} className="aep__radio">
              <input
                type="radio"
                name="visibility"
                value={val}
                checked={form.visibility === val}
                onChange={() => setForm({ ...form, visibility: val })}
              />
              <span className="aep__radio-icon"><FontAwesomeIcon icon={icon} /></span>
              <span>{t(`editor.${labelKey}`)}</span>
            </label>
          ))}
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("editor.seoPreview")}</div>
          <div className="aep__seo">
            <div className="aep__seo-host">{seoHost} › articles</div>
            <div className="aep__seo-title">{form.seoTitle.trim() || form.title || t("editor.seoTitleFallback")}</div>
            <div className="aep__seo-desc">
              {form.seoDescription.trim() || form.excerpt.trim() || t("editor.seoDescFallback")}
            </div>
          </div>

          <input
            className="aep__input aep__input--mt"
            value={form.seoTitle}
            onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
            placeholder={t("editor.seoTitlePlaceholder")}
          />
          <textarea
            className="aep__input aep__input--mt"
            value={form.seoDescription}
            onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
            placeholder={t("editor.seoDescPlaceholder")}
            rows={2}
          />
        </div>
      </aside>
    </div>
  );
}
