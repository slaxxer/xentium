-- Home: articles a member saved, and the categories and tags they follow (the
-- Following feed is built from those).
CREATE TABLE "xcf_article_bookmarks" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_article_bookmarks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_article_bookmarks_article_id_user_id_key" ON "xcf_article_bookmarks"("article_id", "user_id");
CREATE INDEX "xcf_article_bookmarks_user_id_created_at_idx" ON "xcf_article_bookmarks"("user_id", "created_at");
ALTER TABLE "xcf_article_bookmarks" ADD CONSTRAINT "xcf_article_bookmarks_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "xcf_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "xcf_article_bookmarks" ADD CONSTRAINT "xcf_article_bookmarks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "xcf_article_category_follows" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_article_category_follows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_article_category_follows_category_id_user_id_key" ON "xcf_article_category_follows"("category_id", "user_id");
CREATE INDEX "xcf_article_category_follows_user_id_idx" ON "xcf_article_category_follows"("user_id");
ALTER TABLE "xcf_article_category_follows" ADD CONSTRAINT "xcf_article_category_follows_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "xcf_article_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "xcf_article_category_follows" ADD CONSTRAINT "xcf_article_category_follows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "xcf_tag_follows" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_tag_follows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_tag_follows_tag_id_user_id_key" ON "xcf_tag_follows"("tag_id", "user_id");
CREATE INDEX "xcf_tag_follows_user_id_idx" ON "xcf_tag_follows"("user_id");
ALTER TABLE "xcf_tag_follows" ADD CONSTRAINT "xcf_tag_follows_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "xcf_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "xcf_tag_follows" ADD CONSTRAINT "xcf_tag_follows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
