import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  articlesApi, articleCategoriesApi,
  type ArticleLength, type ArticlePeriod, type ArticleSort,
} from "../../lib/articlesApi";
import { authStore } from "../../lib/authStore";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import type { ArticleIndexContext } from "../../layout/blocks/ArticleIndexBlock";
import "./ArticlesListPage.scss";

/** A pill key is either "all" / "drafts" or a category id. */
type PillKey = "all" | "drafts" | string;

const PERIODS: ArticlePeriod[] = ["week", "month", "year"];
const LENGTHS: ArticleLength[] = ["short", "medium", "long"];
const SORTS: ArticleSort[] = ["latest", "popular", "discussed"];
const pick = <T extends string>(list: T[], v: string | null): T | undefined =>
  v && (list as string[]).includes(v) ? (v as T) : undefined;

/**
 * Host container for the `article.index` template (ADR-0005).
 *
 * This component owns everything a block must not: the queries, the auth-gated
 * drafts lookup, and the filter state. What renders, and in which region, comes from
 * the layout document: the `articleIndex` block in `main`, and the rail blocks
 * (`articleCategories`, `articleTrending`, `articleTags`) in `aside`, all reading the
 * same context.
 *
 * Every filter lives in the URL (`?filter=&tag=&q=&period=&len=&sort=&page=`), so a
 * filtered index can be linked, bookmarked and reached with Back. Changing any of
 * them goes back to page 1.
 */
export function ArticlesListPage() {
  const layout = useLayoutDocument("article.index");
  const [params, setParams] = useSearchParams();
  const filter: PillKey = params.get("filter") ?? "all";
  const tag = params.get("tag") ?? "";
  const q = params.get("q") ?? "";
  const period = pick(PERIODS, params.get("period"));
  const length = pick(LENGTHS, params.get("len"));
  const sort = pick(SORTS, params.get("sort")) ?? "latest";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const isAuthed = !!authStore.user;

  const isDrafts = filter === "drafts";
  const categoryId = filter !== "all" && filter !== "drafts" ? filter : undefined;
  // What hides the featured card and shows "Reset filters". Sorting does neither:
  // it reorders the same articles.
  const anyFilter = filter !== "all" || !!tag || !!q || !!period || !!length;

  const listParams = {
    page, limit: 12, categoryId,
    ...(tag ? { tag } : {}), ...(q ? { q } : {}), ...(period ? { period } : {}),
    ...(length ? { length } : {}), ...(sort !== "latest" ? { sort } : {}),
  };
  const articlesQuery = useQuery({
    queryKey: isDrafts ? ["articles-drafts", { page }] : ["articles", listParams],
    queryFn: () =>
      isDrafts
        ? articlesApi.listMine({ status: "draft", page, limit: 12 })
        : articlesApi.list(listParams),
    enabled: !isDrafts || isAuthed,
    placeholderData: (prev) => prev,
  });

  const featuredQuery = useQuery({
    queryKey: ["articles-featured"],
    queryFn: () => articlesApi.featured(),
    staleTime: 60_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ["article-categories"],
    queryFn: () => articleCategoriesApi.tree(),
  });
  const trendingQuery = useQuery({
    queryKey: ["articles-trending"],
    queryFn: () => articlesApi.trending(30, 10),
    staleTime: 5 * 60_000,
  });
  const tagsQuery = useQuery({
    queryKey: ["popular-tags"],
    queryFn: () => articlesApi.popularTags(),
    staleTime: 5 * 60_000,
  });
  const draftsCheckQuery = useQuery({
    queryKey: ["articles-drafts-check"],
    queryFn: () => articlesApi.listMine({ status: "draft", page: 1, limit: 1 }),
    enabled: isAuthed,
  });
  const hasDrafts = (draftsCheckQuery.data?.meta.total ?? 0) > 0;

  /** Change some params; every change except paging goes back to page 1. */
  const update = (patch: Record<string, string | null>, keepPage = false) => {
    const np = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") np.delete(k); else np.set(k, v);
    }
    if (!keepPage) np.delete("page");
    setParams(np, { replace: true });
  };

  const context: ArticleIndexContext = {
    articles:   articlesQuery.data?.data ?? [],
    meta:       articlesQuery.data?.meta,
    categories: categoriesQuery.data ?? [],
    featured:   featuredQuery.data?.article ?? null,
    trending:   trendingQuery.data ?? [],
    tags:       tagsQuery.data ?? [],
    hasDrafts,
    isDrafts,
    isLoading:  articlesQuery.isLoading,
    filter, tag, q, period, length, sort, page, anyFilter,
    setFilter: (key) => update({ filter: key === "all" ? null : key, tag: null }),
    setTag:    (slug) => update({ tag: slug || null, filter: null }),
    setQ:      (text) => update({ q: text.trim() || null }),
    setPeriod: (v) => update({ period: v ?? null }),
    setLength: (v) => update({ len: v ?? null }),
    setSort:   (v) => update({ sort: v === "latest" ? null : v }),
    setPage:   (next) => update({ page: next > 1 ? String(next) : null }, true),
    resetAll:  () => update({ filter: null, tag: null, q: null, period: null, len: null, sort: null }),
  };

  return <LayoutRenderer templateKey="article.index" document={layout} context={context} />;
}
