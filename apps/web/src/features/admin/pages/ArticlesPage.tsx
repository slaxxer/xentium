import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faClockRotateLeft,
  faPlus, faMagnifyingGlass, faPen, faArrowUpRightFromSquare, faEllipsis, faEye, faThumbsUp, faComment,
  faThumbtack, faCommentSlash, faEyeSlash, faRotateLeft, faCheck, faTrashCan, faClock,
} from "@fortawesome/free-solid-svg-icons";
import { CorePermissions } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Username } from "../../../components/Username";
import { Button } from "../../../components/AcpControls";
import { Pager } from "../../../components/Pager";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { timeAgo } from "../../../lib/time";
import { siteTime } from "../../../lib/datetime";
import { uiLocale } from "../../../lib/i18n";
import { userCan } from "../../../lib/authStore";
import { useAuth } from "../../../hooks/useAuth";
import { useDismiss } from "../nav/useDismiss";
import { ArticleCategoriesView, flattenCategories, type CategoryNode } from "./ArticleCategoriesView";
import { ArticleHistoryDialog } from "./ArticleHistoryDialog";
// The overview tiles, filter box and chips are the Moderation Log's.
import "./ModLogPage.scss";
import "./ArticlesPage.scss";

/**
 * ACP · Content · Articles: everything written for the site, and the categories it
 * is filed under (one page, two views: `?view=categories` is the old Categories page).
 *
 * The review queue sits on top when something waits for it; the list narrows by
 * status (Hidden is any status with hiddenAt), category, search and sort; each row's
 * actions are the article's own staff routes (pin, close comments, hide, publish,
 * back to draft), shown only to whoever holds their permission. Several rows can be
 * moved, hidden or deleted at once.
 */

const STATUSES = ["all", "published", "review", "draft", "hidden"] as const;
type StatusTab = (typeof STATUSES)[number];
const SORTS = ["new", "edited", "read", "comments", "title"] as const;
type Sort = (typeof SORTS)[number];
const PAGE_SIZE = 20;

interface Row {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "review" | "published";
  visibility: string;
  featuredImage: string | null;
  readTime: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  pinned: boolean;
  commentsClosed: boolean;
  hidden: boolean;
  author: { id: string; username: string; badgeColor: string | null };
  category: { id: string; name: string } | null;
}
interface ListPage { data: Row[]; meta: { page: number; totalPages: number; total: number } }
export interface ArticleSummary {
  total: number; published: number; review: number; draft: number; hidden: number;
  publishedThisMonth: number; reads: number; oldestReviewAt: string | null; draftAuthors: number;
  byCategory: Record<string, number>;
}

export function ArticlesPage() {
  const { t } = useTranslation("acp");
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "categories" ? "categories" : "articles";
  const summary = useQuery<ArticleSummary>({ queryKey: ["acp-articles-summary"], queryFn: () => api.get("/admin/articles/summary") });
  const categories = useQuery<CategoryNode[]>({ queryKey: ["acp-categories"], queryFn: () => api.get("/article-categories") });

  const go = (next: "articles" | "categories", category?: string) => {
    const p = new URLSearchParams();
    if (next === "categories") p.set("view", "categories");
    if (category) p.set("category", category);
    setParams(p);
  };

  return (
    <div className="arp">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.content")}</p>
          <h1 className="pg-title">{t("articles.title")}</h1>
          <p className="pg-sub">{t(view === "articles" ? "articles.sub" : "categories.sub")}</p>
        </div>
        <div className="arp-head-actions">
          <div className="acp-seg acp-seg--auto" role="tablist" aria-label={t("articles.viewLabel")}>
            {(["articles", "categories"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "is-on" : ""} onClick={() => go(v)}>
                {t(`articles.view.${v}`)}
                <span className="arp-seg-n">{v === "articles" ? summary.data?.total ?? "" : flattenCategories(categories.data ?? []).length || ""}</span>
              </button>
            ))}
          </div>
          {view === "articles" && (
            <Link className="btn-primary" to="/articles/new"><FontAwesomeIcon icon={faPlus} /> {t("articles.new")}</Link>
          )}
        </div>
      </div>

      {view === "articles"
        ? <ArticlesView summary={summary.data} categories={categories.data ?? []} />
        : <ArticleCategoriesView tree={categories.data ?? []} loading={categories.isLoading} counts={summary.data?.byCategory ?? {}}
            onShowArticles={(id) => go("articles", id)} />}
    </div>
  );
}

function ArticlesView({ summary, categories }: { summary: ArticleSummary | undefined; categories: CategoryNode[] }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const category = params.get("category") ?? "";
  const setCategory = (c: string) => { const p = new URLSearchParams(params); if (c) p.set("category", c); else p.delete("category"); setParams(p); };

  // Typing narrows after a pause, not on every key.
  useEffect(() => { const id = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(id); }, [query]);
  // A new filter starts on page one with nothing selected.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [status, sort, q, category]);

  const filter = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
  if (status !== "all") filter.set("status", status);
  if (category) filter.set("category", category);
  if (q) filter.set("q", q);
  const list = useQuery<ListPage>({
    queryKey: ["acp-articles", filter.toString()],
    queryFn: () => api.get(`/admin/articles?${filter}`),
    placeholderData: keepPreviousData,
  });
  const review = useQuery<ListPage>({
    queryKey: ["acp-articles", "review-queue"],
    queryFn: () => api.get("/admin/articles?status=review&limit=5&sort=edited"),
    enabled: (summary?.review ?? 0) > 0,
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["acp-articles"] });
    void qc.invalidateQueries({ queryKey: ["acp-articles-summary"] });
  }, [qc]);

  const act = useMutation({
    mutationFn: ({ run }: { run: () => Promise<unknown>; done: string }) => run(),
    onSuccess: (_r, v) => { toast.success(v.done); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const bulk = useMutation({
    mutationFn: (body: { action: "move" | "hide" | "show" | "delete"; categoryId?: string | null }) =>
      api.post<{ done: number }>("/admin/articles/bulk", { ids: [...selected], ...body }),
    onSuccess: (r) => { toast.success(t("articles.bulkDone", { count: r.done })); setSelected(new Set()); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const can = (key: string) => userCan(user, key);
  const rows = list.data?.data ?? [];
  const totalPages = list.data?.meta.totalPages ?? 1;
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const flat = flattenCategories(categories);
  const counts: Record<StatusTab, number | undefined> = {
    all: summary?.total, published: summary?.published, review: summary?.review, draft: summary?.draft, hidden: summary?.hidden,
  };

  async function askDelete(a: Row) {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("articles.deleteTitle"), body: t("articles.deleteText", { title: a.title }),
      confirmText: t("articles.delete"), cancelText: t("common:actions.cancel"),
    });
    if (ok) act.mutate({ run: () => api.delete(`/admin/articles/${a.id}`), done: t("articles.toastDeleted") });
  }
  async function askBulkDelete() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("articles.bulkDeleteTitle", { count: selected.size }), body: t("articles.bulkDeleteText"),
      confirmText: t("articles.delete"), cancelText: t("common:actions.cancel"),
    });
    if (ok) bulk.mutate({ action: "delete" });
  }
  const publish = (a: Row) => act.mutate({ run: () => api.post(`/articles/${a.id}/publish`), done: t("articles.toastPublished") });
  const toDraft = (a: Row) => act.mutate({ run: () => api.post(`/articles/${a.id}/unpublish`), done: t("articles.toastDraft") });

  const filtered = status !== "all" || !!category || !!q;
  const oldest = summary?.oldestReviewAt;

  return (
    <>
      <section className="mlp-stats" aria-label={t("articles.statsLabel")}>
        <Stat value={summary?.published} label={t("articles.statPublished")} sub={t("articles.statPublishedSub", { count: summary?.publishedThisMonth ?? 0 })} />
        <Stat value={summary?.review} label={t("articles.statReview")} tone="warn"
          sub={oldest ? t("articles.statReviewSub", { ago: timeAgo(oldest) }) : t("articles.statReviewNone")} />
        <Stat value={summary?.draft} label={t("articles.statDrafts")} sub={t("articles.statDraftsSub", { count: summary?.draftAuthors ?? 0 })} />
        <Stat value={summary ? summary.reads.toLocaleString(uiLocale()) : undefined} label={t("articles.statReads")} sub={t("articles.statReadsSub")} tone="accent" />
      </section>

      {(review.data?.data.length ?? 0) > 0 && (
        <section className="arp-review" aria-label={t("articles.reviewLabel")}>
          <header className="arp-review__head">
            <FontAwesomeIcon icon={faClock} />
            <h2>{t("articles.reviewTitle", { count: summary?.review ?? 0 })}</h2>
            <span>{t("articles.reviewSub")}</span>
          </header>
          {review.data!.data.map((a) => (
            <div key={a.id} className="arp-review__row">
              <div className="arp-review__text">
                <b>{a.title}</b>
                <span>
                  <Username username={a.author.username} badgeColor={a.author.badgeColor} /> · {a.category?.name ?? t("articles.uncategorised")} · {t("articles.sent", { ago: timeAgo(a.updatedAt) })}
                </span>
              </div>
              <Link className="btn-ghost" to={`/articles/${a.slug}`} target="_blank">{t("articles.read")}</Link>
              <Button variant="ghost" onClick={() => toDraft(a)} disabled={act.isPending || !can(CorePermissions.ARTICLE_EDIT_ANY)}>{t("articles.toDraft")}</Button>
              <Button icon={faCheck} onClick={() => publish(a)} disabled={act.isPending || !can(CorePermissions.ARTICLE_PUBLISH)}>{t("articles.publish")}</Button>
            </div>
          ))}
        </section>
      )}

      <section className="mlp-filters" aria-label={t("articles.filtersLabel")}>
        <div className="mlp-filters__row">
          <label className="mlp-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("articles.searchPh")} aria-label={t("articles.searchLabel")} />
          </label>
          <label className="mlp-by">
            <span>{t("articles.category")}</span>
            <select className="acp-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("articles.categoryAll")}</option>
              {flat.map((c) => <option key={c.id} value={c.id}>{"– ".repeat(c.depth)}{c.name}</option>)}
              <option value="none">{t("articles.uncategorised")}</option>
            </select>
          </label>
          <label className="mlp-by">
            <span>{t("articles.sortLabel")}</span>
            <select className="acp-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s} value={s}>{t(`articles.sort.${s}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="mlp-kinds" role="radiogroup" aria-label={t("articles.statusLabel")}>
          {STATUSES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} className={`mlp-kind arp-st--${s}${status === s ? " is-on" : ""}`} onClick={() => setStatus(s)}>
              <span className="mlp-kind__dot" aria-hidden="true" />
              {t(`articles.tab.${s}`)}
              {counts[s] !== undefined && <span className="mlp-kind__n">{counts[s]}</span>}
            </button>
          ))}
        </div>
      </section>

      {selected.size > 0 && (
        <div className="arp-bulk" role="toolbar" aria-label={t("articles.bulkLabel")}>
          <b>{t("articles.selected", { count: selected.size })}</b>
          {can(CorePermissions.ARTICLE_EDIT_ANY) && (
            <select className="acp-select" value="" aria-label={t("articles.moveTo")} disabled={bulk.isPending}
              onChange={(e) => e.target.value && bulk.mutate({ action: "move", categoryId: e.target.value === "none" ? null : e.target.value })}>
              <option value="">{t("articles.moveTo")}</option>
              {flat.map((c) => <option key={c.id} value={c.id}>{"– ".repeat(c.depth)}{c.name}</option>)}
              <option value="none">{t("articles.uncategorised")}</option>
            </select>
          )}
          {can(CorePermissions.ARTICLE_HIDE) && <>
            <Button variant="ghost" icon={faEyeSlash} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: "hide" })}>{t("articles.hide")}</Button>
            <Button variant="ghost" icon={faEye} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: "show" })}>{t("articles.show")}</Button>
          </>}
          {can(CorePermissions.ARTICLE_DELETE_ANY) && (
            <Button variant="ghost-danger" icon={faTrashCan} disabled={bulk.isPending} onClick={askBulkDelete}>{t("articles.delete")}</Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>{t("articles.clear")}</Button>
        </div>
      )}

      {list.isLoading ? (
        <p className="mlp-muted">{t("articles.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="mlp-empty">
          <p>{t(filtered ? "articles.emptyFiltered" : "articles.empty")}</p>
          {filtered
            ? <Button variant="ghost" onClick={() => { setStatus("all"); setCategory(""); setQuery(""); }}>{t("articles.showEverything")}</Button>
            : <Link className="btn-primary" to="/articles/new"><FontAwesomeIcon icon={faPlus} /> {t("articles.new")}</Link>}
        </div>
      ) : (
        <section className="arp-list" aria-label={t("articles.listLabel")}>
          <div className="arp-row arp-row--head">
            <input type="checkbox" aria-label={t("articles.selectAll")} checked={allOn}
              onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
            <span>{t("articles.colArticle")}</span>
            <span>{t("articles.colAuthor")}</span>
            <span>{t("articles.colStatus")}</span>
            <span>{t("articles.colReaders")}</span>
            <span className="arp-right">{t("articles.colActions")}</span>
          </div>
          {rows.map((a) => (
            <ArticleRow key={a.id} a={a} selected={selected.has(a.id)} can={can} busy={act.isPending}
              onSelect={() => setSelected((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
              onAct={(run, done) => act.mutate({ run, done })}
              onPublish={() => publish(a)} onDraft={() => toDraft(a)} onDelete={() => askDelete(a)} />
          ))}
          <Pager page={page} totalPages={totalPages} onPage={(n) => { setPage(n); setSelected(new Set()); }}
            label={t("articles.pageOf", { page, totalPages, total: list.data?.meta.total ?? 0 })} />
        </section>
      )}
    </>
  );
}

function ArticleRow({ a, selected, can, busy, onSelect, onAct, onPublish, onDraft, onDelete }: {
  a: Row; selected: boolean; can: (key: string) => boolean; busy: boolean;
  onSelect: () => void;
  onAct: (run: () => Promise<unknown>, done: string) => void;
  onPublish: () => void; onDraft: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation("acp");
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const ref = useDismiss<HTMLDivElement>(menu, close);
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };

  const when = a.status === "published" && a.publishedAt ? siteTime.date(a.publishedAt)
    : a.status === "review" ? t("articles.sent", { ago: timeAgo(a.updatedAt) })
    : t("articles.edited", { ago: timeAgo(a.updatedAt) });
  const published = a.status === "published";
  const items = [
    published && can(CorePermissions.ARTICLE_EDIT_ANY) && { icon: faThumbtack, label: t(a.pinned ? "articles.unpin" : "articles.pin"),
      run: () => onAct(() => api.post(`/articles/${a.id}/pin`, { pinned: !a.pinned }), t(a.pinned ? "articles.toastUnpinned" : "articles.toastPinned")) },
    can(CorePermissions.ARTICLE_COMMENTS_CLOSE) && { icon: faCommentSlash, label: t(a.commentsClosed ? "articles.openComments" : "articles.closeComments"),
      run: () => onAct(() => api.post(`/articles/${a.id}/comments-closed`, { closed: !a.commentsClosed }), t(a.commentsClosed ? "articles.toastReopened" : "articles.toastClosed")) },
    can(CorePermissions.ARTICLE_HIDE) && { icon: a.hidden ? faEye : faEyeSlash, label: t(a.hidden ? "articles.show" : "articles.hide"),
      run: () => onAct(() => api.post(`/articles/${a.id}/hidden`, { hidden: !a.hidden }), t(a.hidden ? "articles.toastShown" : "articles.toastHidden")) },
    !published && can(CorePermissions.ARTICLE_PUBLISH) && { icon: faCheck, label: t("articles.publish"), run: onPublish },
    a.status !== "draft" && can(CorePermissions.ARTICLE_EDIT_ANY) && { icon: faRotateLeft, label: t("articles.toDraft"), run: onDraft },
    (can(CorePermissions.ARTICLE_REVISIONS_VIEW) || can(CorePermissions.ARTICLE_EDIT_ANY)) && { icon: faClockRotateLeft, label: t("articles.history.menu"), run: () => setHistory(true) },
  ].filter(Boolean) as { icon: typeof faPen; label: string; run: () => void }[];

  return (
    <div className={`arp-row${selected ? " is-selected" : ""}${a.hidden ? " is-hidden" : ""}`}>
      <input type="checkbox" aria-label={t("articles.select", { title: a.title })} checked={selected} onChange={onSelect} />
      <div className="arp-art">
        {a.featuredImage
          ? <img className="arp-thumb" src={`/uploads/${a.featuredImage}`} alt="" loading="lazy" />
          : <span className="arp-thumb" aria-hidden="true">{a.title.charAt(0).toUpperCase()}</span>}
        <div className="arp-art__text">
          <Link className="arp-art__title" to={`/articles/${a.slug}/edit`}>{a.title}</Link>
          <span className="arp-art__meta">
            <span className={a.category ? "arp-catname" : "arp-catname is-none"}>{a.category?.name ?? t("articles.uncategorised")}</span>
            <span>{t("articles.minRead", { count: a.readTime })}</span>
            {a.pinned && <span className="arp-flag arp-flag--accent">{t("articles.flag.pinned")}</span>}
            {a.commentsClosed && <span className="arp-flag">{t("articles.flag.commentsClosed")}</span>}
            {a.visibility !== "public" && <span className="arp-flag arp-flag--info">{t(`articles.flag.${a.visibility === "members" ? "members" : "private"}`)}</span>}
            {a.hidden && <span className="arp-flag arp-flag--danger">{t("articles.flag.hidden")}</span>}
          </span>
        </div>
      </div>
      <div className="arp-author">
        <span className="arp-av" style={a.author.badgeColor ? { ["--arp-av" as string]: a.author.badgeColor } : undefined} aria-hidden="true">
          {a.author.username.slice(0, 2).toUpperCase()}
        </span>
        <Username username={a.author.username} badgeColor={a.author.badgeColor} />
      </div>
      <div className="arp-status">
        <span className={`arp-pill arp-pill--${a.status}`}>{t(`articles.status.${a.status}`)}</span>
        <span>{when}</span>
      </div>
      <div className="arp-nums">
        <span title={t("articles.views")}><FontAwesomeIcon icon={faEye} />{a.viewCount.toLocaleString(uiLocale())}</span>
        <span title={t("articles.likes")}><FontAwesomeIcon icon={faThumbsUp} />{a.likeCount.toLocaleString(uiLocale())}</span>
        <span title={t("articles.comments")}><FontAwesomeIcon icon={faComment} />{a.commentCount.toLocaleString(uiLocale())}</span>
      </div>
      <div className="arp-actions" ref={ref}>
        <Link className="arp-ic" to={`/articles/${a.slug}/edit`} title={t("articles.edit")} aria-label={t("articles.editOne", { title: a.title })}>
          <FontAwesomeIcon icon={faPen} />
        </Link>
        <Link className="arp-ic" to={`/articles/${a.slug}`} target="_blank" title={t("articles.open")} aria-label={t("articles.openOne", { title: a.title })}>
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </Link>
        <button type="button" className={`arp-ic${menu ? " is-on" : ""}`} aria-haspopup="menu" aria-expanded={menu}
          aria-label={t("articles.more", { title: a.title })} onClick={() => setMenu((m) => !m)}>
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
        {menu && (
          <div className="arp-menu" role="menu">
            {items.map((it) => (
              <button key={it.label} type="button" role="menuitem" disabled={busy} onClick={pick(it.run)}>
                <FontAwesomeIcon icon={it.icon} /> {it.label}
              </button>
            ))}
            {/* Deleting one article is the ACP's own route (admin.access), as before. */}
            {items.length > 0 && <div className="arp-menu__sep" />}
            <button type="button" role="menuitem" className="is-danger" onClick={pick(onDelete)}>
              <FontAwesomeIcon icon={faTrashCan} /> {t("articles.deleteEllipsis")}
            </button>
          </div>
        )}
      </div>
      {history && <ArticleHistoryDialog articleId={a.id} title={a.title} onClose={() => setHistory(false)} />}
    </div>
  );
}

function Stat({ value, label, sub, tone }: { value: number | string | undefined; label: string; sub: string; tone?: "warn" | "accent" }) {
  return (
    <div className={`mlp-stat${tone ? ` mlp-stat--${tone}` : ""}`}>
      <b>{value ?? "–"}</b>
      <span className="mlp-caps">{label}</span>
      <span className="mlp-muted">{sub}</span>
    </div>
  );
}
