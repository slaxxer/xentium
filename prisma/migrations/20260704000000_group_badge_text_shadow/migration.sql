-- Per-group username "glow": a text-shadow toggle on the badge, applied to the
-- username colour everywhere the name renders. Admin-controlled.
ALTER TABLE "ncf_group_progression" ADD COLUMN "badge_text_shadow" BOOLEAN NOT NULL DEFAULT false;
