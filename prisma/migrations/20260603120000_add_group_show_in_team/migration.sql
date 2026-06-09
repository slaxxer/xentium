ALTER TABLE "Group" ADD COLUMN "show_in_team" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Group" SET "show_in_team" = true WHERE key IN ('admin', 'supermod', 'moderator');
