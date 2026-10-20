-- Profile fields: help text, default privacy, minimum sign-up age, longest answer,
-- link prefix and choice options.
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "help_text" TEXT;
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "default_privacy" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "min_age" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "max_length" INTEGER;
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "link_prefix" TEXT;
ALTER TABLE "xcf_user_profile_fields" ADD COLUMN "options" JSONB;

-- The profile page linked GitHub answers to github.com in code; that is now this setting.
UPDATE "xcf_user_profile_fields" SET "link_prefix" = 'https://github.com/' WHERE "key" = 'github' AND "link_prefix" IS NULL;
