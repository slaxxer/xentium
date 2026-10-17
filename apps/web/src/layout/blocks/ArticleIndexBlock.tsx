/**
 * `articleIndex` — the article listing: head with search and view toggle, the
 * featured (pinned) article, the toolbar (heading, count, period, length, sort),
 * the grid or list, pagination. Plus the three rail blocks that sit beside it:
 * `articleCategories`, `articleTrending`, `articleTags`.
 *
 * `articleIndex` stays ONE block because its parts share interaction state. Splitting
 * the toolbar from the grid would let an admin put a control in one region driving a
 * list in another, which is a support ticket waiting to happen. The rail blocks are
 * separate on purpose: they are independent cards an admin may drop or reorder, and
 * they drive the same filters through the shared context.
 *
 * No block here queries. `ArticlesListPage` resolves the data, the categories (with
 * counts), the featured article, trending and tags, and the URL-backed filter state,
 * then hands them over as context — the ADR-0005 rule that keeps access control out
 * of theme-authored configuration. View mode is the one piece of state the main block
 * owns, because it is presentation only and never leaves the block.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faTableCells, faList, faMagnifyingGlass, faXmark, faThumbtack, faChevronDown, faCheck, faArrowTrendUp,
} from "@fortawesome/free-solid-svg-icons";
import {
  faHeart, faComment, faCalendar, faClock, faNewspaper,
} from "@fortawesome/free-regular-svg-icons";
import type {
  ArticleCategoryNode, ArticleLength, ArticleListItem, ArticlePeriod, ArticleSort, TrendingArticle,
} from "../../lib/articlesApi";
import { UserAvatar } from "../../components/UserAvatar";
import { Username } from "../../components/Username";
import type { BlockProps } from "../blockRegistry";
import { useDateTime } from "../../lib/datetime";

type View = "grid" | "list";

/** Resolved by the host container — queries and permissions already applied. */
export interface ArticleIndexContext {
  articles:   ArticleListItem[];
  meta?:      { page: number; total?: number; totalPages: number; hasPrev: boolean; hasNext: boolean };
  categories: ArticleCategoryNode[];
  featured:   ArticleListItem | null;
  trending:   TrendingArticle[];
  tags:       { name: string; slug: string; count: number }[];
  hasDrafts:  boolean;
  isDrafts:   boolean;
  isLoading:  boolean;
  filter:     string;
  tag:        string;
  q:          string;
  period?:    ArticlePeriod;
  length?:    ArticleLength;
  sort:       ArticleSort;
  page:       number;
  /** A category, tag, search, period or length is set (sorting alone is not). */
  anyFilter:  boolean;
  setFilter:  (key: string) => void;
  setTag:     (slug: string) => void;
  setQ:       (text: string) => void;
  setPeriod:  (v: ArticlePeriod | undefined) => void;
  setLength:  (v: ArticleLength | undefined) => void;
  setSort:    (v: ArticleSort) => void;
  setPage:    (page: number) => void;
  resetAll:   () => void;
}

interface Props { defaultView: View; showFilters: boolean; showFeatured: boolean; columns: 2 | 3 }

/** The categories as one flat list (the tree's children follow their parent). */
function flatCategories(nodes: ArticleCategoryNode[]): ArticleCategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatCategories(n.children ?? [])]);
}

export function ArticleIndexBlock({ props, context }: BlockProps<Props, ArticleIndexContext>) {
  const { t } = useTranslation(["articles", "common"]);
  const [view, setView] = useState<View>(props.defaultView);
  const c = context;

  // The search box is typed into locally and written to the URL after a pause, so
  // the list does not refetch on every keystroke.
  const [text, setText] = useState(c.q);
  useEffect(() => { setText(c.q); }, [c.q]);
  useEffect(() => {
    if (text.trim() === c.q) return;
    const id = window.setTimeout(() => c.setQ(text), 250);
    return () => window.clearTimeout(id);
  }, [text]);

  const showFeatured = props.showFeatured && !!c.featured && c.page === 1 && !c.anyFilter && !c.isDrafts;
  const list = showFeatured ? c.articles.filter((a) => a.id !== c.featured!.id) : c.articles;
  const category = flatCategories(c.categories).find((x) => x.id === c.filter);

  const heading = c.isDrafts ? t("list.drafts")
    : c.q ? t("list.resultsFor", { q: c.q })
    : c.tag ? `#${c.tags.find((x) => x.slug === c.tag)?.name ?? c.tag}`
    : category ? category.name
    : showFeatured ? t("list.latestHeading")
    : t("list.allHeading");
  const total = c.meta?.total;

  return (
    <div className="al">
      <header className="al__head">
        <div>
          <div className="al__eyebrow">{t("list.eyebrow")}</div>
          <h1 className="al__title">{t("list.title")}</h1>
        </div>
        <div className="al__head-tools">
          <label className="al__search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input type="search" value={text} placeholder={t("list.searchPlaceholder")}
              aria-label={t("list.searchPlaceholder")} onChange={(e) => setText(e.target.value)} />
            {text && (
              <button type="button" aria-label={t("list.clearSearch")} title={t("list.clearSearch")}
                onClick={() => { setText(""); c.setQ(""); }}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </label>
          <div className="al__view-toggle">
            <button className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}
              aria-label={t("list.gridView")} aria-pressed={view === "grid"} type="button">
              <FontAwesomeIcon icon={faTableCells} />
            </button>
            <button className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}
              aria-label={t("list.listView")} aria-pressed={view === "list"} type="button">
              <FontAwesomeIcon icon={faList} />
            </button>
          </div>
        </div>
      </header>

      {showFeatured && <FeaturedCard a={c.featured!} />}

      <section className="al__section">
        <div className="al__toolbar">
          <div className="al__toolbar-left">
            <h2 className="al__heading">{heading}</h2>
            {total != null && <span className="al__count">{t("list.count", { count: total })}</span>}
            {(c.anyFilter || c.sort !== "latest") && (
              <button type="button" className="al__reset" onClick={c.resetAll}>{t("list.reset")}</button>
            )}
          </div>
          {props.showFilters && !c.isDrafts && (
            <div className="al__toolbar-right">
              <Dropdown icon={faCalendar} value={c.period}
                options={(["week", "month", "year"] as ArticlePeriod[]).map((v) => ({ v, label: t(`list.period.${v}`) }))}
                anyLabel={t("list.period.any")} onPick={c.setPeriod} />
              <Dropdown icon={faClock} value={c.length}
                options={(["short", "medium", "long"] as ArticleLength[]).map((v) => ({ v, label: t(`list.length.${v}`) }))}
                anyLabel={t("list.length.any")} onPick={c.setLength} />
              <div className="al__sort" role="group" aria-label={t("list.sortLabel")}>
                {(["latest", "popular", "discussed"] as ArticleSort[]).map((s) => (
                  <button key={s} type="button" className={c.sort === s ? "is-on" : ""} aria-pressed={c.sort === s}
                    onClick={() => c.setSort(s)}>
                    {t(`list.sort.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {c.isLoading && <p className="al__loading">{t("actions.loading", { ns: "common" })}</p>}
        {/* Not when the page's only article is the featured one above: the list is
            empty, but the index is not. */}
        {!c.isLoading && list.length === 0 && !(showFeatured && c.articles.length > 0) && (
          <div className="al__empty">
            <FontAwesomeIcon icon={faNewspaper} className="al__empty-ic" />
            <b>{c.isDrafts ? t("list.noDrafts") : c.anyFilter ? t("list.emptyTitle") : t("list.noArticles")}</b>
            {c.anyFilter && <p>{t("list.emptyHint")}</p>}
            {c.anyFilter && (
              <button type="button" className="btn-primary" onClick={c.resetAll}>{t("list.reset")}</button>
            )}
          </div>
        )}

        {list.length > 0 && (view === "grid" ? (
          <div className={`al__grid al__grid--${props.columns}`}>
            {list.map((a) => <ArticleGridCard key={a.id} a={a} draft={c.isDrafts} />)}
          </div>
        ) : (
          <div className="al__list">
            {list.map((a) => <ArticleListRow key={a.id} a={a} draft={c.isDrafts} />)}
          </div>
        ))}

        {c.meta && c.meta.totalPages > 1 && (
          <nav className="al__pagination">
            <button disabled={!c.meta.hasPrev} onClick={() => c.setPage(c.page - 1)} type="button">
              {t("list.prev")}
            </button>
            <span>{t("list.pageOf", { page: c.meta.page, total: c.meta.totalPages })}</span>
            <button disabled={!c.meta.hasNext} onClick={() => c.setPage(c.page + 1)} type="button">
              {t("list.next")}
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}

/** A toolbar menu: one choice from a short list, "any" first. Active = not "any". */
function Dropdown<T extends string>({ icon, value, options, anyLabel, onPick }: {
  icon: typeof faCalendar;
  value: T | undefined;
  options: { v: T; label: string }[];
  anyLabel: string;
  onPick: (v: T | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const all = [{ v: undefined as T | undefined, label: anyLabel }, ...options];
  const current = options.find((o) => o.v === value)?.label ?? anyLabel;
  return (
    <div className="al__dd" ref={ref}>
      <button type="button" className={`al__dd-btn${value ? " is-on" : ""}`} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <FontAwesomeIcon icon={icon} />{current}<FontAwesomeIcon icon={faChevronDown} className="al__dd-caret" />
      </button>
      {open && (
        <div className="al__dd-menu" role="menu">
          {all.map((o) => (
            <button key={o.v ?? "any"} type="button" role="menuitemradio" aria-checked={o.v === value}
              className={o.v === value ? "is-on" : ""} onClick={() => { onPick(o.v); setOpen(false); }}>
              {o.label}
              {o.v === value && <FontAwesomeIcon icon={faCheck} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Counts({ a }: { a: { likeCount: number; commentCount: number } }) {
  return (
    <span className="al__counts">
      <span><FontAwesomeIcon icon={faHeart} />{a.likeCount}</span>
      <span><FontAwesomeIcon icon={faComment} />{a.commentCount}</span>
    </span>
  );
}

function Cover({ a, className }: { a: ArticleListItem; className: string }) {
  return a.featuredImage
    ? <img className={className} src={`/uploads/${a.featuredImage}`} alt="" />
    : <div className={`${className} ${className}--placeholder`} />;
}

function FeaturedCard({ a }: { a: ArticleListItem }) {
  const { t } = useTranslation("articles");
  const dt = useDateTime();
  return (
    <Link to={`/articles/${a.slug}`} className="al-feat">
      <div className="al-feat__media">
        <Cover a={a} className="al-feat__img" />
        <span className="al-feat__pin"><FontAwesomeIcon icon={faThumbtack} />{t("list.featured")}</span>
      </div>
      <div className="al-feat__body">
        {a.category && <div><span className="badge">{a.category.name}</span></div>}
        <h2 className="al-feat__title">{a.title || t("list.untitled")}</h2>
        {a.excerpt && <p className="al-feat__excerpt">{a.excerpt}</p>}
        <div className="al-feat__foot">
          <UserAvatar user={a.author} size={32} />
          <div className="al-feat__by">
            <Username className="al-feat__name" username={a.author.username} badgeColor={a.author.badgeColor} />
            <span>{a.publishedAt ? dt.date(a.publishedAt) : ""} · {t("list.minRead", { n: a.readTime })}</span>
          </div>
          <Counts a={a} />
        </div>
      </div>
    </Link>
  );
}

function ArticleGridCard({ a, draft }: { a: ArticleListItem; draft?: boolean }) {
  const { t } = useTranslation("articles");
  const dt = useDateTime();
  const to = draft ? `/articles/${a.slug}/edit` : `/articles/${a.slug}`;
  return (
    <Link to={to} className="ac">
      <Cover a={a} className="ac__img" />
      <div className="ac__body">
        <div className="ac__top">
          <span className="ac__badges">
            {draft && <span className="badge badge--muted">{t("list.draftBadge")}</span>}
            {a.category && <span className="badge">{a.category.name}</span>}
          </span>
          <span className="ac__read">{t("list.minRead", { n: a.readTime })}</span>
        </div>
        <h3 className="ac__title">{a.title || <em>{t("list.untitled")}</em>}</h3>
        {a.excerpt && <p className="ac__excerpt">{a.excerpt}</p>}
        <div className="ac__meta">
          <UserAvatar user={a.author} size={22} />
          <Username className="ac__author" username={a.author.username} badgeColor={a.author.badgeColor} />
          <span className="ac__date">· {a.publishedAt ? dt.date(a.publishedAt) : t("list.draftBadge")}</span>
          <Counts a={a} />
        </div>
      </div>
    </Link>
  );
}

function ArticleListRow({ a, draft }: { a: ArticleListItem; draft?: boolean }) {
  const { t } = useTranslation("articles");
  const dt = useDateTime();
  const to = draft ? `/articles/${a.slug}/edit` : `/articles/${a.slug}`;
  return (
    <Link to={to} className="ar">
      <Cover a={a} className="ar__img" />
      <div className="ar__body">
        <div className="ar__badges">
          {draft && <span className="badge badge--muted">{t("list.draftBadge")}</span>}
          {a.category && <span className="badge">{a.category.name}</span>}
        </div>
        <h3 className="ar__title">{a.title || <em>{t("list.untitled")}</em>}</h3>
        {a.excerpt && <p className="ar__excerpt">{a.excerpt}</p>}
        <div className="ar__meta">
          <UserAvatar user={a.author} size={20} />
          <Username username={a.author.username} badgeColor={a.author.badgeColor} />
          <span>· {a.publishedAt ? dt.date(a.publishedAt) : t("list.draftBadge")} · {t("list.minRead", { n: a.readTime })}</span>
          <Counts a={a} />
        </div>
      </div>
    </Link>
  );
}

// ── The rail ────────────────────────────────────────────────────────────────

export function ArticleCategoriesBlock({ context }: BlockProps<Record<string, never>, ArticleIndexContext>) {
  const { t } = useTranslation("articles");
  const c = context;
  if (!c) return null;
  const cats = flatCategories(c.categories);
  const total = cats.reduce((n, x) => n + (x.count ?? 0), 0);
  const item = (key: string, label: string, count: number | null, extra = "") => (
    <button key={key} type="button" className={`al-rail__cat${c.filter === key ? " is-on" : ""}${extra}`}
      aria-pressed={c.filter === key} onClick={() => c.setFilter(key)}>
      <span>{label}</span>
      {count != null && <span className="al-rail__pill">{count}</span>}
    </button>
  );
  return (
    <section className="al-rail">
      <div className="al-rail__label">{t("list.rail.categories")}</div>
      {item("all", t("list.rail.all"), total)}
      {cats.map((x) => item(x.id, x.name, x.count ?? 0))}
      {c.hasDrafts && item("drafts", t("list.drafts"), null, " al-rail__cat--draft")}
    </section>
  );
}

export function ArticleTrendingBlock({ props, context }: BlockProps<{ max: number; days: number }, ArticleIndexContext>) {
  const { t } = useTranslation("articles");
  const rows = (context?.trending ?? []).slice(0, props.max);
  if (rows.length === 0) return null;
  return (
    <section className="al-rail">
      <div className="al-rail__label"><FontAwesomeIcon icon={faArrowTrendUp} className="al-rail__trend-ic" />{t("list.rail.trending")}</div>
      {rows.map((r, i) => (
        <Link key={r.id} to={`/articles/${r.slug}`} className="al-rail__trend">
          <span className="al-rail__rank">{String(i + 1).padStart(2, "0")}</span>
          <span>
            <span className="al-rail__trend-title">{r.title}</span>
            <Counts a={r} />
          </span>
        </Link>
      ))}
    </section>
  );
}

export function ArticleTagsBlock({ props, context }: BlockProps<{ max: number }, ArticleIndexContext>) {
  const { t } = useTranslation("articles");
  const c = context;
  const tags = (c?.tags ?? []).slice(0, props.max);
  if (!c || tags.length === 0) return null;
  return (
    <section className="al-rail">
      <div className="al-rail__label">{t("list.rail.tags")}</div>
      <div className="al-rail__tags">
        {tags.map((x) => (
          <button key={x.slug} type="button" className={`al-rail__tag${c.tag === x.slug ? " is-on" : ""}`}
            aria-pressed={c.tag === x.slug} onClick={() => c.setTag(c.tag === x.slug ? "" : x.slug)}>
            #{x.name}
          </button>
        ))}
      </div>
    </section>
  );
}
