-- Theme Studio history: one row per publish, holding the theme's whole published state
-- (tokens, custom CSS, font, layouts + site frame) so History can stage it back as a draft.
CREATE TABLE "xcf_theme_revisions" (
    "id" TEXT NOT NULL,
    "theme_key" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "tokens" JSONB NOT NULL,
    "custom_css" TEXT NOT NULL DEFAULT '',
    "font" JSONB NOT NULL,
    "layouts" JSONB NOT NULL,
    "saved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xcf_theme_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xcf_theme_revisions_theme_key_created_at_idx" ON "xcf_theme_revisions"("theme_key", "created_at");

ALTER TABLE "xcf_theme_revisions" ADD CONSTRAINT "xcf_theme_revisions_saved_by_id_fkey"
  FOREIGN KEY ("saved_by_id") REFERENCES "xcf_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
