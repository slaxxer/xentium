// apps/web/src/features/articles/components/ArticleCard.tsx
import { useTranslation } from "react-i18next";
import "./ArticleCard.scss";
import { useDateTime } from "../../../lib/datetime";

interface Article {
  slug: string; title: string; excerpt: string;
  category: string; publishedAt: string; readTime: number; views: number;
}

export function ArticleCard({ article }: { article: Article }) {
  const { t } = useTranslation("articles");
  const dt = useDateTime();
  return (
    <div className="article-card">
      <div className="article-category">{article.category}</div>
      <h3 className="article-title">
        <a href={`/articles/${article.slug}`}>{article.title}</a>
      </h3>
      <div className="article-meta">
        <span><time dateTime={article.publishedAt}>{dt.date(article.publishedAt)}</time></span>
        <span>{t("reader.minRead", { n: article.readTime })}</span>
        <span>{t("list.views", { count: article.views })}</span>
      </div>
      <p className="article-excerpt">{article.excerpt}</p>
    </div>
  );
}
