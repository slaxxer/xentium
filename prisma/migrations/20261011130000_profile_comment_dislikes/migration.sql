-- Dislikes on wall comments, beside likes. A member holds one or the other, never both.
ALTER TABLE "xcf_profile_comments" ADD COLUMN "dislike_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "xcf_profile_comment_dislikes" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xcf_profile_comment_dislikes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "xcf_profile_comment_dislikes_comment_id_user_id_key" ON "xcf_profile_comment_dislikes"("comment_id", "user_id");

ALTER TABLE "xcf_profile_comment_dislikes" ADD CONSTRAINT "xcf_profile_comment_dislikes_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "xcf_profile_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "xcf_profile_comment_dislikes" ADD CONSTRAINT "xcf_profile_comment_dislikes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
