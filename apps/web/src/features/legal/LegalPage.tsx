import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { isLegalDocumentKey } from "@xentium/contracts";
import { legalApi } from "../../lib/legalApi";
import { useAuth } from "../../hooks/useAuth";
import { ArticleContent } from "../articles/components/ArticleContent";
import "./LegalPage.scss";

/**
 * `/legal/:key` — terms, privacy, disclaimer, imprint.
 *
 * Deliberately NOT a layout template: these routes and their text are core's, so no
 * layout or theme can drop an imprint a site is legally required to show. The title
 * is the translated name of the document, never admin text.
 */
export function LegalPage() {
  const { t, i18n } = useTranslation("common");
  const { key = "" } = useParams<{ key: string }>();
  const { user } = useAuth();
  const valid = isLegalDocumentKey(key);

  const query = useQuery({
    queryKey: ["legal", key],
    queryFn: () => legalApi.get(key as never),
    enabled: valid,
    retry: false,
  });

  // Unknown key, or a document not published yet.
  if (!valid || query.isError) return <div className="legal-view__state">{t("pageNotFound")}</div>;
  if (query.isLoading || !query.data) {
    return <div className="legal-view__state">{t("actions.loading")}</div>;
  }

  const doc = query.data;
  const updated = new Date(doc.publishedAt).toLocaleDateString(i18n.language, { dateStyle: "long" });
  // legal.manage is admin-only by default; an edit link others would only meet a 403 behind.
  const canEdit = user?.groups?.some((g) => g.key === "admin") ?? false;

  return (
    <article className="legal-view">
      <header className="legal-view__head">
        <h1 className="legal-view__title">{t(`legal.title.${doc.key}`)}</h1>
        <p className="legal-view__meta">
          {t("legal.lastUpdated", { date: updated })}
          {canEdit && (
            <> · <Link to={`/admin/legal?doc=${doc.key}`}>{t("legal.edit")}</Link></>
          )}
        </p>
      </header>
      <div className="legal-view__body">
        <ArticleContent body={doc.body} />
      </div>
    </article>
  );
}
