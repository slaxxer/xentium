-- Badges are GLYPHS ONLY.
--
-- The uploaded-image option is removed: a 32x32 upload and a FontAwesome glyph
-- never sat at the same size in a mixed row, and a catalogue where every mark is
-- drawn the same way is worth more than the freedom to upload one.
--
-- ⚠ Dropping the column orphans any file under `uploads/badges/`. Nothing points
-- at them any more and the purge job no longer knows the folder, so they are
-- deleted by hand alongside this migration rather than left to a sweep.
ALTER TABLE "ncf_badges" DROP COLUMN IF EXISTS "icon";
