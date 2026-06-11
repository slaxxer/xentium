-- Add view_count column to articles. Real view tracking arrives via Redis-backed
-- per-IP dedup at the service layer (see article.service.ts).
ALTER TABLE "articles" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
