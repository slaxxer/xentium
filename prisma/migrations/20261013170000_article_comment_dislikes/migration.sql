-- Thumbs-down on article comments, beside the thumbs-up (likes). A member holds one or
-- the other, never both.
CREATE TABLE "xcf_article_comment_dislikes" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_article_comment_dislikes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_article_comment_dislikes_comment_id_user_id_key" ON "xcf_article_comment_dislikes"("comment_id", "user_id");
ALTER TABLE "xcf_article_comment_dislikes" ADD CONSTRAINT "xcf_article_comment_dislikes_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "xcf_article_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "xcf_article_comment_dislikes" ADD CONSTRAINT "xcf_article_comment_dislikes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
