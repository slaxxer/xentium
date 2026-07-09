-- Per-group username "glow" is now fully configurable (ACP → Progression → Badge):
-- an independent shadow colour (null = use the badge colour) plus X/Y/blur offsets
-- in px. Extends the earlier boolean toggle (badge_text_shadow).
ALTER TABLE "ncf_group_progression" ADD COLUMN "badge_shadow_color" TEXT;
ALTER TABLE "ncf_group_progression" ADD COLUMN "badge_shadow_x" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ncf_group_progression" ADD COLUMN "badge_shadow_y" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ncf_group_progression" ADD COLUMN "badge_shadow_blur" INTEGER NOT NULL DEFAULT 20;
