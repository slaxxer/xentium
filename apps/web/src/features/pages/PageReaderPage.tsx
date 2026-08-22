import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { pagesApi } from "../../lib/pagesApi";
import { useAuth } from "../../hooks/useAuth";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import type { PageDetailContext } from "../../layout/blocks/pageDetailBlocks";
import "./PageReaderPage.scss";

/**
 * Host container for the `page.detail` template (ADR-0005).
 *
 * It owns everything a block must not: the query, the not-found and loading
 * states, and the staff check. WHAT renders and in which region comes from the
 * layout document — the code default reproduces the previous hardcoded arrangement
 * exactly, so adopting the template changed nothing on screen.
 *
 * The staff Edit shortcut is deliberately NOT a block. An admin who could move it
 * could also delete it, and the affordance for fixing a page should not be
 * something a layout can remove.
 */
export function PageReaderPage() {
  const { t } = useTranslation(["common", "acp"]);
  const { slug = "" } = useParams<{ slug: string }>();
  const { user } = useAuth();
  // The page's own layout if an admin gave it one, else the template default.
  const layout = useLayoutDocument("page.detail", slug);

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
  const context: PageDetailContext = {
    page: {
      id:            p.id,
      title:         p.title,
      body:          p.body,
      featuredImage: p.featuredImage ?? null,
    },
  };

  return (
    <article className="page-view">
      {canManagePages && (
        <div className="page-view__admin-bar">
          <Link to={`/pages/${p.id}/edit`} className="btn btn--sm btn--ghost">
            <FontAwesomeIcon icon={faPenToSquare} /> {t("acp:pages.editPage")}
          </Link>
        </div>
      )}

      <LayoutRenderer templateKey="page.detail" document={layout} context={context} />
    </article>
  );
}
