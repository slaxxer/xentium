-- The moderator looking into a review case (ACP → Moderation → Review Cases).
ALTER TABLE "xcf_moderation_cases" ADD COLUMN "assigned_to" TEXT;
