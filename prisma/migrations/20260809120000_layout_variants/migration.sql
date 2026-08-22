-- Per-page layouts (ADR-0005, variant axis).
--
-- Until now every custom page shared one `page.detail` document. A variant lets a
-- single page carry its own arrangement while the rest keep the template default.
--
-- `variant` is '' for "the template default", NOT NULL. Deliberately: Postgres
-- treats NULLs as DISTINCT in a unique index, so a nullable column would happily
-- admit two rows for (template_key, NULL, scope) — the exact duplicate the
-- constraint exists to prevent. An empty string has no such exemption.
ALTER TABLE "ncf_layouts"
  ADD COLUMN "variant" TEXT NOT NULL DEFAULT '';

-- Replaces the two-column uniqueness: one draft and one published document per
-- (template, variant).
DROP INDEX "ncf_layouts_template_key_scope_key";

CREATE UNIQUE INDEX "ncf_layouts_template_key_variant_scope_key"
  ON "ncf_layouts"("template_key", "variant", "scope");

-- Resolution reads the variant row then falls back to the default row, so the
-- lookup is always by (template_key, variant).
CREATE INDEX "ncf_layouts_scope_template_key_idx"
  ON "ncf_layouts"("scope", "template_key");
