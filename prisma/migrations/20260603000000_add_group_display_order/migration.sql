-- Group badge precedence (lower = higher priority).
ALTER TABLE "Group" ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 100;
UPDATE "Group" SET "display_order" = 1 WHERE key = 'admin';
UPDATE "Group" SET "display_order" = 2 WHERE key = 'supermod';
UPDATE "Group" SET "display_order" = 3 WHERE key = 'moderator';
UPDATE "Group" SET "display_order" = 4 WHERE key = 'member';
