-- Per-theme appearance: every theme (and the built-in Core theme, '') carries its own
-- layouts and token history. Existing rows start as Core; a boot migration moves them
-- to the theme that was active when this ran (see perThemeMigration.ts).
ALTER TABLE "xcf_layouts" ADD COLUMN "theme_key" TEXT NOT NULL DEFAULT '';

DROP INDEX "xcf_layouts_template_key_variant_scope_key";
DROP INDEX "xcf_layouts_scope_template_key_idx";
CREATE UNIQUE INDEX "xcf_layouts_theme_key_template_key_variant_scope_key" ON "xcf_layouts"("theme_key", "template_key", "variant", "scope");
CREATE INDEX "xcf_layouts_theme_key_scope_template_key_idx" ON "xcf_layouts"("theme_key", "scope", "template_key");

ALTER TABLE "xcf_style_history" ADD COLUMN "theme_key" TEXT NOT NULL DEFAULT '';
CREATE INDEX "xcf_style_history_theme_key_created_at_idx" ON "xcf_style_history"("theme_key", "created_at");
