import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { articlesApi, articleCategoriesApi } from "../../lib/articlesApi";
import { authStore } from "../../lib/authStore";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import type { ArticleIndexContext } from "../../layout/blocks/ArticleIndexBlock";
import "./ArticlesListPage.scss";

/** A pill key is either "all" / "drafts" or a category id. */
type PillKey = "all" | "drafts" | string;

/**
 * Host container for the `article.index` template (ADR-0005).
 *
 * This component owns everything a block must not: the queries, the auth-gated
 * drafts lookup, and the URL-backed filter/page state. What renders — and in
 * which region — comes from the layout document, which today is the code default
 * (`DEFAULT_LAYOUTS["article.index"]`) and later the admin's stored document.
 *
 * The markup itself lives in the `articleIndex` block, unchanged.
 */
export function ArticlesListPage() {
  const layout = useLayoutDocument("article.index");
  const [params, setParams] = useSearchParams();
  const filter: PillKey = params.get("filter") ?? "all";
  const page = parseInt(params.get("page") ?? "1", 10);
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

  const context: ArticleIndexContext = {
    articles:   articlesQuery.data?.data ?? [],
    meta:       articlesQuery.data?.meta,
    categories: categoriesQuery.data ?? [],
    hasDrafts,
    isDrafts,
    isLoading:  articlesQuery.isLoading,
    filter,
    page,
    setFilter,
    setPage,
  };

  return <LayoutRenderer templateKey="article.index" document={layout} context={context} />;
}
