import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { pagesApi } from "../../lib/pagesApi";
import { useAuth } from "../../hooks/useAuth";
import { ArticleContent } from "../articles/components/ArticleContent";
import "./PageReaderPage.scss";

/** Public reader for a custom page. Strictly title + TipTap body inside the
 *  normal AppLayout — no templates, no blocks (§page-system). */
export function PageReaderPage() {
  const { t } = useTranslation(["common", "acp"]);
  const { slug = "" } = useParams<{ slug: string }>();
  const { user } = useAuth();

  // page.manage is admin + supermod — show them an inline Edit shortcut.
  const canManagePages = user?.groups?.some((g) => g.key === "admin" || g.key === "supermod") ?? false;

  const pageQuery = useQuery({
    queryKey: ["page", slug],
    queryFn: () => pagesApi.getBySlug(slug),
    enabled: !!slug,
  });

  if (pageQuery.isLoading) return <div className="page-view__state">{t("common:actions.loading")}</div>;
  if (pageQuery.isError || !pageQuery.data) {
    return <div className="page-view__state">{t("common:pageNotFound")}</div>;
  }

  const p = pageQuery.data;

  return (
    <article className="page-view">
      {canManagePages && (
        <div className="page-view__admin-bar">
          <Link to={`/pages/${p.id}/edit`} className="btn btn--sm btn--ghost">
            <FontAwesomeIcon icon={faPenToSquare} /> {t("acp:pages.editPage")}
          </Link>
        </div>
      )}

      {p.featuredImage && (
        <img className="page-view__header-image" src={`/uploads/${p.featuredImage}`} alt="" />
      )}

      <h1 className="page-view__title">{p.title}</h1>
      <div className="page-view__body">
        <ArticleContent body={p.body} />
      </div>
    </article>
  );
}
