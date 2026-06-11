-- Add search_vector column to articles (managed by trigger, not Prisma)
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
CREATE INDEX IF NOT EXISTS "articles_search_idx" ON "articles" USING GIN("search_vector");

-- Add like_count to profile_comments (was added manually, formalise here)
ALTER TABLE "profile_comments" ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0;
