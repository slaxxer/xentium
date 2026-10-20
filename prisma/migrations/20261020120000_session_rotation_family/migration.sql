-- Refresh-token families: replay of a rotated token revokes every session of that sign-in.
ALTER TABLE "xcf_sessions" ADD COLUMN "familyId" TEXT;
ALTER TABLE "xcf_sessions" ADD COLUMN "replacedById" TEXT;
CREATE INDEX "xcf_sessions_familyId_idx" ON "xcf_sessions"("familyId");
