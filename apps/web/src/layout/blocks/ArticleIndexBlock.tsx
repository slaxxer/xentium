/**
 * `articleIndex` — the article listing: filters, view toggle, grid/list, pagination.
 *
 * One block rather than several because those parts share interaction state.
 * Splitting the toggle from the grid would let an admin put a control in one
 * region driving a list in another, which is a support ticket waiting to happen.
 *
 * The block does NOT query. `ArticlesListPage` resolves the data, the categories
 * and the URL-backed filter/page state, then hands them over as context — the
 * ADR-0005 rule that keeps access control out of theme-authored configuration.
 * View mode is the one piece of state the block owns, because it is presentation
 * only and never leaves the block.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTableCells, faList, faHeart, faComment } from "@fortawesome/free-solid-svg-icons";
import type { ArticleListItem } from "../../lib/articlesApi";
import { UserAvatar } from "../../components/UserAvatar";
import { Username } from "../../components/Username";
import type { BlockProps } from "../blockRegistry";

type View = "grid" | "list";

/** Resolved by the host container — queries and permissions already applied. */
export interface ArticleIndexContext {
  articles:   ArticleListItem[];
  meta?:      { page: number; totalPages: number; hasPrev: boolean; hasNext: boolean };
  categories: { id: string; name: string }[];
  hasDrafts:  boolean;
  isDrafts:   boolean;
  isLoading:  boolean;
  filter:     string;
  page:       number;
  setFilter:  (key: string) => void;
  setPage:    (page: number) => void;
}

interface Props { defaultView: View; showFilters: boolean }

export function ArticleIndexBlock({ props, context }: BlockProps<Props, ArticleIndexContext>) {
  const { t } = useTranslation(["articles", "common"]);
  const [view, setView] = useState<View>(props.defaultView);
  const c = context;

  return (
    <div className="al">
      <header className="al__head">
        <div>
          <div className="al__eyebrow">{t("list.eyebrow")}</div>
          <h1 className="al__title">{t("list.title")}</h1>
        </div>
        <div className="al__view-toggle">
          <button
            className={view === "grid" ? "is-active" : ""}
            onClick={() => setView("grid")}
            aria-label={t("list.gridView")}
            type="button"
          >
            <FontAwesomeIcon icon={faTableCells} />
          </button>
          <button
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
            aria-label={t("list.listView")}
            type="button"
          >
            <FontAwesomeIcon icon={faList} />
          </button>
        </div>
      </header>

      {props.showFilters && (
        <div className="al__filters">
          <button
            className={`al__pill ${c.filter === "all" ? "is-active" : ""}`}
            onClick={() => c.setFilter("all")}
            type="button"
          >
            {t("list.all")}
          </button>
          {c.hasDrafts && (
            <button
              className={`al__pill al__pill--draft ${c.isDrafts ? "is-active" : ""}`}
              onClick={() => c.setFilter("drafts")}
              type="button"
            >
              {t("list.drafts")}
            </button>
          )}
          {c.categories.map((cat) => (
            <button
              key={cat.id}
              className={`al__pill ${c.filter === cat.id ? "is-active" : ""}`}
              onClick={() => c.setFilter(cat.id)}
              type="button"
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {c.isLoading && <p className="al__empty">{t("actions.loading", { ns: "common" })}</p>}
      {!c.isLoading && c.articles.length === 0 && (
        <p className="al__empty">
          {c.isDrafts ? t("list.noDrafts") : t("list.noArticles")}
        </p>
      )}

      {view === "grid" ? (
        <div className="al__grid">
          {c.articles.map((a) => (
            <ArticleGridCard key={a.id} a={a} draft={c.isDrafts} />
          ))}
        </div>
      ) : (
        <div className="al__list">
          {c.articles.map((a) => (
            <ArticleListRow key={a.id} a={a} draft={c.isDrafts} />
          ))}
        </div>
      )}

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
    </div>
  );
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "Draft";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ArticleGridCard({ a, draft }: { a: ArticleListItem; draft?: boolean }) {
  const { t } = useTranslation("articles");
  const to = draft ? `/articles/${a.slug}/edit` : `/articles/${a.slug}`;
  return (
    <Link to={to} className="ac">
      {a.featuredImage && (
        <img className="ac__img" src={`/uploads/${a.featuredImage}`} alt="" />
      )}
      <div className="ac__body">
        <div className="ac__badges">
          {draft && <span className="badge badge--muted">{t("list.draftBadge")}</span>}
          {a.category && <span className="badge">{a.category.name}</span>}
        </div>
        <h2 className="ac__title">{a.title || <em>{t("list.untitled")}</em>}</h2>
        {a.excerpt && <p className="ac__excerpt">{a.excerpt}</p>}
        <div className="ac__meta">
          <UserAvatar user={a.author} size={20} />
          <Username className="ac__author" username={a.author.username} badgeColor={a.author.badgeColor} />
          <span className="ac__date">
            {formatShortDate(a.publishedAt ?? a.updatedAt)} · {t("list.minRead", { n: a.readTime })}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ArticleListRow({ a, draft }: { a: ArticleListItem; draft?: boolean }) {
  const { t } = useTranslation("articles");
  const to = draft ? `/articles/${a.slug}/edit` : `/articles/${a.slug}`;
  return (
    <Link to={to} className="ar">
      {a.featuredImage ? (
        <img className="ar__img" src={`/uploads/${a.featuredImage}`} alt="" />
      ) : (
        <div className="ar__img ar__img--placeholder" />
      )}
      <div className="ar__body">
        <div className="ar__badges">
          {draft && <span className="badge badge--muted">{t("list.draftBadge")}</span>}
          {a.category && <span className="badge">{a.category.name}</span>}
        </div>
        <h2 className="ar__title">{a.title || <em>{t("list.untitled")}</em>}</h2>
        {a.excerpt && <p className="ar__excerpt">{a.excerpt}</p>}
        <div className="ar__meta">
          <UserAvatar user={a.author} size={20} />
          <Username username={a.author.username} badgeColor={a.author.badgeColor} />
          <span>·</span>
          <span>{formatShortDate(a.publishedAt ?? a.updatedAt)} · {t("list.minRead", { n: a.readTime })}</span>
          <span>·</span>
          <span><FontAwesomeIcon icon={faHeart} /> {a.likeCount}</span>
          <span><FontAwesomeIcon icon={faComment} /> {a.commentCount}</span>
        </div>
      </div>
    </Link>
  );
}
