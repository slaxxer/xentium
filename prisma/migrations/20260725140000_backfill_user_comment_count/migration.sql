-- Backfill ncf_users.comment_count from existing published, non-deleted article
-- comments, so the progression `min_comments` threshold is not evaluated against
-- a column that starts at 0 for every pre-existing member.
UPDATE "ncf_users" u
SET "comment_count" = c.n
FROM (
  SELECT "author_id", COUNT(*)::int AS n
  FROM "ncf_article_comments"
  WHERE "deleted_at" IS NULL AND "status" = 'published'
  GROUP BY "author_id"
) c
WHERE u."id" = c."author_id";
