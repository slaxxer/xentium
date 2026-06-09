-- Add per-user language preference (§60.4). NULL = follow resolution chain.
ALTER TABLE "User" ADD COLUMN "preferred_locale" TEXT;
