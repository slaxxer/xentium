-- Block layout composition (ADR-0005). At most two rows per template: the draft
-- an admin is editing and the published one the site serves. Absence is valid —
-- a template with no row renders the code default from @nodevo/contracts, which
-- is also what "Reset to default" restores by deleting rows.
CREATE TABLE "ncf_layouts" (
  "id"             TEXT NOT NULL,
  "template_key"   TEXT NOT NULL,
  "scope"          TEXT NOT NULL,
  "document"       JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id"  TEXT,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ncf_layouts_pkey" PRIMARY KEY ("id")
);

-- One draft and one published document per template; the upsert target.
CREATE UNIQUE INDEX "ncf_layouts_template_key_scope_key"
  ON "ncf_layouts"("template_key", "scope");
