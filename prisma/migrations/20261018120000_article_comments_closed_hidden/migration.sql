-- Moderation on articles: close comments, hide the article.
ALTER TABLE "xcf_articles" ADD COLUMN "comments_closed_at" TIMESTAMP(3);
ALTER TABLE "xcf_articles" ADD COLUMN "comments_closed_by_id" TEXT;
ALTER TABLE "xcf_articles" ADD COLUMN "hidden_at" TIMESTAMP(3);
ALTER TABLE "xcf_articles" ADD COLUMN "hidden_by_id" TEXT;
