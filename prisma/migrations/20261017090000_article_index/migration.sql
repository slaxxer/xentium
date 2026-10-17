-- The redesigned article index: a pinned (featured) article, and reading time as a
-- column so the index can filter by length in the query.
ALTER TABLE "xcf_articles" ADD COLUMN "read_time" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "xcf_articles" ADD COLUMN "pinned_at" TIMESTAMP(3);
CREATE INDEX "xcf_articles_pinned_at_idx" ON "xcf_articles"("pinned_at");

-- The same rule the API uses: words / 200, rounded, at least 1.
UPDATE "xcf_articles"
   SET "read_time" = GREATEST(1, ROUND(
         COALESCE(array_length(regexp_split_to_array(btrim("body_plain"), '\s+'), 1), 0)::numeric / 200
       )::int)
 WHERE "body_plain" IS NOT NULL AND btrim("body_plain") <> '';
