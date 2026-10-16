-- Replies on the profile wall: a comment may answer another, one level deep. Existing
-- comments are all top-level (NULL), so nothing about the current walls changes.
ALTER TABLE "xcf_profile_comments" ADD COLUMN "parent_id" TEXT;

ALTER TABLE "xcf_profile_comments" ADD CONSTRAINT "xcf_profile_comments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "xcf_profile_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "xcf_profile_comments_parent_id_created_at_idx" ON "xcf_profile_comments"("parent_id", "created_at");
