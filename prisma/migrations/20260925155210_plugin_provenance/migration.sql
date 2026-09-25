-- Where an installed plugin came from, and whether Xentium reviewed it.
--
-- All three are nullable with no default: every plugin installed before this
-- migration predates the signature format, and NULL is the honest answer for
-- them — "we do not know", not "unsigned". They are re-recorded on the next
-- update, which re-reads the package.
ALTER TABLE "xcf_installed_plugins" ADD COLUMN "signature_tier" TEXT;
ALTER TABLE "xcf_installed_plugins" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "xcf_installed_plugins" ADD COLUMN "content_digest" TEXT;
