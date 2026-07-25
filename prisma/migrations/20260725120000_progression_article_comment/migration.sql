-- Progression core/plugin split (§38): forum-specific thresholds/limits move out
-- of core into the forum plugin (registerProgressionCriteria + its own storage).
-- Core keeps article/comment metrics. Pre-alpha: old column data is dropped.
ALTER TABLE "ncf_group_progression" DROP COLUMN "min_posts";
ALTER TABLE "ncf_group_progression" DROP COLUMN "min_threads";
ALTER TABLE "ncf_group_progression" DROP COLUMN "max_post_length";
ALTER TABLE "ncf_group_progression" DROP COLUMN "max_daily_posts";
ALTER TABLE "ncf_group_progression" ADD COLUMN "min_articles" INTEGER;
ALTER TABLE "ncf_group_progression" ADD COLUMN "min_comments" INTEGER;
ALTER TABLE "ncf_group_progression" ADD COLUMN "max_comment_length" INTEGER;
ALTER TABLE "ncf_group_progression" ADD COLUMN "max_daily_comments" INTEGER;

-- Per-user article-comment count for the min_comments threshold.
ALTER TABLE "ncf_users" ADD COLUMN "comment_count" INTEGER NOT NULL DEFAULT 0;
