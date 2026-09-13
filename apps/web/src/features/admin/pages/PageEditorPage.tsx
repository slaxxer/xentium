import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../hooks/useAuth";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faGlobe, faLock, faImage } from "@fortawesome/free-solid-svg-icons";
import { PAGE_SLOTS, type PageSlot } from "@xentium/contracts";
import {
  useArticleEditor,
  ArticleEditorToolbar,
  ArticleEditorBody,
} from "../../articles/components/ArticleEditor";
import { pagesApi, pagePath, type PageVisibility } from "../../../lib/pagesApi";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import "../../articles/ArticleEditorPage.scss";

const EMPTY_BODY = { type: "doc", content: [{ type: "paragraph" }] };

function wordCount(json: unknown): number {
  const text: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (typeof node.text === "string") text.push(node.text);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c as { text?: string; content?: unknown[] });
  };
  if (json && typeof json === "object") walk(json as { text?: string; content?: unknown[] });
  return text.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

export function PageEditorPage() {
  const { t } = useTranslation("acp");
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  // page.manage is granted to admin + supermod. Non-staff hitting the editor URL
  // would only get 403s on save — bounce them out for a clean UX.
  const canManagePages = user?.groups?.some((g) => g.key === "admin" || g.key === "supermod") ?? false;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState<unknown>(EMPTY_BODY);
  const [visibility, setVisibility] = useState<PageVisibility>("public");
  const [seoDescription, setSeoDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [slug, setSlug] = useState<string | null>(null);
  const [navPlacement, setNavPlacement] = useState<"navbar" | "footer" | null>(null);
  const [featuredUrl, setFeaturedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editor = useArticleEditor({ value: body, onChange: setBody });

  const pageQuery = useQuery({
    queryKey: ["acp-page", id],
    queryFn: () => pagesApi.getById(id!),
    enabled: !isNew,
  });

  useEffect(() => {
    const d = pageQuery.data;
    if (!d) return;
    setTitle(d.title);
    setBody(d.body ?? EMPTY_BODY);
    setVisibility(d.visibility);
    setSeoDescription(d.seoDescription ?? "");
    setStatus(d.status);
    setSlug(d.slug);
    setNavPlacement(d.navPlacement);
    setFeaturedUrl(d.featuredImage ? `/uploads/${d.featuredImage}` : null);
  }, [pageQuery.data]);

  const slotsQuery = useQuery({
    queryKey: ["acp-page-slots"],
    queryFn: fetchSlots,
    enabled: !isNew,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const input = { title: title.trim(), body, visibility, seoDescription: seoDescription.trim() || undefined };
      return isNew ? pagesApi.create(input) : pagesApi.update(id!, input);
    },
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ["acp-pages"] });
      swalToast(t("pages.toastSaved"), "success");
      if (isNew) navigate(`/pages/${page.id}/edit`, { replace: true });
      else { setSlug(page.slug); setStatus(page.status); }
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const publishMut = useMutation({
    mutationFn: () => (status === "published" ? pagesApi.unpublish(id!) : pagesApi.publish(id!)),
    onSuccess: (page) => {
      setStatus(page.status);
      qc.invalidateQueries({ queryKey: ["acp-pages"] });
      swalToast(page.status === "published" ? t("pages.toastPublished") : t("pages.toastUnpublished"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const navMut = useMutation({
    mutationFn: async (placement: "navbar" | "footer" | "none") => {
      if (placement === "none") await pagesApi.removeFromNav(id!);
      else await pagesApi.addToNav(id!, placement);
    },
    onSuccess: (_res, placement) => {
      setNavPlacement(placement === "none" ? null : placement);
      qc.invalidateQueries({ queryKey: ["acp-pages"] });
      swalToast(t("pages.toastNavSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const slotMut = useMutation({
    mutationFn: (slot: PageSlot | "") => assignPageToSlot(id!, slot === "" ? null : slot),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-page-slots"] });
      swalToast(t("pages.toastSlotSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // Image uploads need a saved page (storage is scoped under the page id). For a
  // new page, create a draft first and switch the URL to its edit route.
  const ensureId = async (): Promise<string> => {
    if (id) return id;
    const page = await pagesApi.create({
      title: title.trim() || "Untitled",
      body,
      visibility,
      seoDescription: seoDescription.trim() || undefined,
    });
    qc.invalidateQueries({ queryKey: ["acp-pages"] });
    setSlug(page.slug);
    navigate(`/pages/${page.id}/edit`, { replace: true });
    return page.id;
  };

  const featuredMut = useMutation({
    mutationFn: async (file: File) => {
      const pid = await ensureId();
      return pagesApi.uploadFeaturedImage(pid, file);
    },
    onSuccess: ({ url }) => setFeaturedUrl(url),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleUploadImage = async (file: File): Promise<string> => {
    const pid = await ensureId();
    const { url } = await pagesApi.uploadImage(pid, file);
    return url;
  };

  const currentSlot: PageSlot | "" =
    (PAGE_SLOTS.find((s) => slotsQuery.data?.[s] === id) as PageSlot | undefined) ?? "";

  const canSave = title.trim().length >= 2;
  const isBusy = saveMut.isPending || publishMut.isPending;
  const words = wordCount(body);

  // All hooks above run unconditionally; guard only affects render.
  if (user && !canManagePages) return <Navigate to="/" replace />;

  return (
    <div className="aep">
      <div className="aep__main">
        <ArticleEditorToolbar
          editor={editor}
          onUploadImage={handleUploadImage}
          rightSlot={`${t("pages.wordsN", { n: words })} · ${t(`pages.status.${status}`)}`}
        />
        <div className="aep__canvas">
          <div className="aep__canvas-inner">
            <input
              className="aep__title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("pages.titlePlaceholder")}
            />
            {slug && (
              <div className="aep__byline">
                <span>{t("pages.urlLabel")}: <code>{pagePath(slug)}</code></span>
              </div>
            )}
            <ArticleEditorBody editor={editor} placeholder={t("pages.bodyPlaceholder")} />
          </div>
        </div>
      </div>

      <aside className="aep__sidebar">
        <div className="aep__section">
          <div className="aep__label">{t("pages.actions")}</div>
          <button
            className="aep__btn aep__btn--primary"
            disabled={!canSave || isBusy}
            onClick={() => saveMut.mutate()}
            type="button"
          >
            {saveMut.isPending ? t("pages.saving") : t("pages.save")}
          </button>
          {!isNew && (
            <button
              className="aep__btn aep__btn--ghost"
              disabled={publishMut.isPending}
              onClick={() => publishMut.mutate()}
              type="button"
            >
              {status === "published" ? t("pages.unpublish") : t("pages.publish")}
            </button>
          )}
          <button className="aep__btn aep__btn--ghost" onClick={() => navigate("/admin/pages")} type="button">
            {t("pages.backToList")}
          </button>
          {!isNew && status === "published" && slug && (
            <a className="aep__btn aep__btn--ghost" href={pagePath(slug)} target="_blank" rel="noreferrer">
              {t("pages.view")}
            </a>
          )}
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("pages.headerImage")}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) featuredMut.mutate(f);
              e.target.value = "";
            }}
          />
          <div
            className={`aep__dropzone ${dragging ? "is-dragging" : ""} ${featuredMut.isPending ? "is-busy" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) featuredMut.mutate(f);
            }}
          >
            {featuredUrl ? (
              <>
                <img className="aep__dropzone-preview" src={featuredUrl} alt="" />
                <div className="aep__dropzone-text">
                  {featuredMut.isPending ? t("pages.uploading") : t("pages.replaceImage")}
                </div>
              </>
            ) : (
              <>
                <div className="aep__dropzone-icon"><FontAwesomeIcon icon={faImage} /></div>
                <div className="aep__dropzone-text">
                  {featuredMut.isPending ? t("pages.uploading") : t("pages.dropImage")}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("pages.colVisibility")}</div>
          {([
            [faGlobe, "public", "public"],
            [faLock, "members", "members"],
          ] as [typeof faGlobe, PageVisibility, string][]).map(([icon, val, labelKey]) => (
            <label key={val} className="aep__radio">
              <input
                type="radio"
                name="visibility"
                value={val}
                checked={visibility === val}
                onChange={() => setVisibility(val)}
              />
              <span className="aep__radio-icon"><FontAwesomeIcon icon={icon} /></span>
              <span>{t(`pages.visibility.${labelKey}`)}</span>
            </label>
          ))}
        </div>

        {!isNew && (
          <>
            <div className="aep__divider" />
            <div className="aep__section">
              <div className="aep__label">{t("pages.navigation")}</div>
              <select
                className="aep__select"
                value={navPlacement ?? ""}
                onChange={(e) => navMut.mutate((e.target.value || "none") as "navbar" | "footer" | "none")}
                disabled={navMut.isPending}
              >
                <option value="">{t("pages.navNone")}</option>
                <option value="navbar">{t("pages.navNavbar")}</option>
                <option value="footer">{t("pages.navFooter")}</option>
              </select>
            </div>

            <div className="aep__divider" />
            <div className="aep__section">
              <div className="aep__label">{t("pages.slot")}</div>
              <select
                className="aep__select"
                value={currentSlot}
                onChange={(e) => slotMut.mutate(e.target.value as PageSlot | "")}
                disabled={slotMut.isPending}
              >
                <option value="">{t("pages.slotNone")}</option>
                {PAGE_SLOTS.map((s) => (
                  <option key={s} value={s}>{t(`pages.slots.${s}`)}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="aep__divider" />

        <div className="aep__section">
          <div className="aep__label">{t("pages.seoDescription")}</div>
          <textarea
            className="aep__input"
            rows={3}
            maxLength={500}
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            placeholder={t("pages.seoPlaceholder")}
          />
        </div>
      </aside>
    </div>
  );
}

// ── Slot helpers (admin) ────────────────────────────────────────────────────

async function fetchSlots(): Promise<Record<PageSlot, string | null>> {
  return api.get<Record<PageSlot, string | null>>("/admin/pages/slots");
}

/** Make `pageId` occupy exactly `targetSlot` (or no slot when null): clear any
 *  other slot currently holding this page, then assign the target. A page lives
 *  in at most one slot. */
async function assignPageToSlot(pageId: string, targetSlot: PageSlot | null): Promise<void> {
  const current = await fetchSlots();
  for (const s of PAGE_SLOTS) {
    if (current[s] === pageId && s !== targetSlot) {
      await api.put("/admin/pages/slots", { slot: s, pageId: null });
    }
  }
  if (targetSlot) await api.put("/admin/pages/slots", { slot: targetSlot, pageId });
}
