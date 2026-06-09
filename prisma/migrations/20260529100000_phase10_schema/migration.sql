-- Phase 10: add eventType to LoginEvent; add deletedBy relations to comments
-- search_vector columns are managed by the earlier 20260529000005 migration

-- LoginEvent: eventType for security analysis
ALTER TABLE "LoginEvent" ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'login';
CREATE INDEX IF NOT EXISTS "LoginEvent_deviceCookieId_idx" ON "LoginEvent"("deviceCookieId");
CREATE INDEX IF NOT EXISTS "LoginEvent_eventType_createdAt_idx" ON "LoginEvent"(event_type, "createdAt" DESC);

-- Ensure search_vector columns survive (idempotent guard)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS "User_search_idx" ON "User" USING GIN(search_vector);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS articles_search_idx ON articles USING GIN(search_vector);
