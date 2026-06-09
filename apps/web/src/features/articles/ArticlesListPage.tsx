import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTableCells,
  faList,
  faHeart,
  faComment,
} from "@fortawesome/free-solid-svg-icons";
import { articlesApi, articleCategoriesApi, type ArticleListItem } from "../../lib/articlesApi";
import { authStore } from "../../lib/authStore";
import { UserAvatar } from "../../components/UserAvatar";
import { Username } from "../../components/Username";
import "./ArticlesListPage.scss";

type View = "grid" | "list";

/** A pill key is either "all" / "drafts" or a category id. */
type PillKey = "all" | "drafts" | string;

export function ArticlesListPage() {
  const { t } = useTranslation(["articles", "common"]);
  const [params, setParams] = useSearchParams();
  const filter: PillKey = params.get("filter") ?? "all";
  const page = parseInt(params.get("page") ?? "1", 10);
  const [view, setView] = useState<View>("grid");
  const isAuthed = !!authStore.user;

  const isDrafts = filter === "drafts";
  const categoryId = filter !== "all" && filter !== "drafts" ? filter : undefined;

  const articlesQuery = useQuery({
    queryKey: isDrafts
      ? ["articles-drafts", { page }]
      : ["articles", { page, categoryId }],
    queryFn: () =>
      isDrafts
        ? articlesApi.listMine({ status: "draft", page, limit: 12 })
        : articlesApi.list({ page, limit: 12, categoryId }),
    enabled: !isDrafts || isAuthed,
  });

  const categoriesQuery = useQuery({
    queryKey: ["article-categories"],
    queryFn: () => articleCategoriesApi.tree(),
  });

  const draftsCheckQuery = useQuery({
    queryKey: ["articles-drafts-check"],
    queryFn: () => articlesApi.listMine({ status: "draft", page: 1, limit: 1 }),
    enabled: isAuthed,
  });
  const hasDrafts = (draftsCheckQuery.data?.meta.total ?? 0) > 0;

  const setPage = (next: number) => {
    const np = new URLSearchParams(params);
    np.set("page", String(next));
    setParams(np, { replace: true });
  };
  const setFilter = (key: PillKey) => {
    const np = new URLSearchParams(params);
    if (key === "all") np.delete("filter");
    else np.set("filter", key);
    np.set("page", "1");
    setParams(np, { replace: true });
  };

  const data = articlesQuery.data?.data ?? [];
  const meta = articlesQuery.data?.meta;

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

      <div className="al__filters">
        <button
          className={`al__pill ${filter === "all" ? "is-active" : ""}`}
          onClick={() => setFilter("all")}
          type="button"
        >
          {t("list.all")}
        </button>
        {hasDrafts && (
          <button
            className={`al__pill al__pill--draft ${isDrafts ? "is-active" : ""}`}
            onClick={() => setFilter("drafts")}
            type="button"
          >
            {t("list.drafts")}
          </button>
        )}
        {categoriesQuery.data?.map((c) => (
          <button
            key={c.id}
            className={`al__pill ${filter === c.id ? "is-active" : ""}`}
            onClick={() => setFilter(c.id)}
            type="button"
          >
            {c.name}
          </button>
        ))}
      </div>

      {articlesQuery.isLoading && <p className="al__empty">{t("actions.loading", { ns: "common" })}</p>}
      {!articlesQuery.isLoading && data.length === 0 && (
        <p className="al__empty">
          {isDrafts ? t("list.noDrafts") : t("list.noArticles")}
        </p>
      )}

      {view === "grid" ? (
        <div className="al__grid">
          {data.map((a) => (
            <ArticleGridCard key={a.id} a={a} draft={isDrafts} />
          ))}
        </div>
      ) : (
        <div className="al__list">
          {data.map((a) => (
            <ArticleListRow key={a.id} a={a} draft={isDrafts} />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <nav className="al__pagination">
          <button disabled={!meta.hasPrev} onClick={() => setPage(page - 1)} type="button">
            {t("list.prev")}
          </button>
          <span>{t("list.pageOf", { page: meta.page, total: meta.totalPages })}</span>
          <button disabled={!meta.hasNext} onClick={() => setPage(page + 1)} type="button">
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
