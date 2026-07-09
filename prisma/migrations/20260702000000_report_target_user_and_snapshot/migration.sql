-- Reports carry the reported content's author (enables Warn/Ban quick actions on
-- the ModCanvas report row) and a text snapshot captured at filing time (so the
-- report stays reviewable after the content is deleted or pruned).
ALTER TABLE "ncf_moderation_reports" ADD COLUMN "target_user_id" TEXT;
ALTER TABLE "ncf_moderation_reports" ADD COLUMN "content_snapshot" TEXT;

ALTER TABLE "ncf_moderation_reports"
  ADD CONSTRAINT "ncf_moderation_reports_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "ncf_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
