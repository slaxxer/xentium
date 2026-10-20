-- The admin's order of moderation templates within an action (0 = never placed).
ALTER TABLE "xcf_moderation_templates" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
