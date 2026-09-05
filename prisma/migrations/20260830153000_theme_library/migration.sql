-- The theme LIBRARY. Installed is not active — the same distinction plugins draw
-- (§10/§54), and for the same reason: trying a second theme must not destroy the
-- first. Until now a single settings key (`appearance.theme.installed`) held one
-- manifest, so importing a theme silently replaced whatever was installed before.
--
-- `payload` carries the theme's APPLICABLE form — layout documents, tokens and
-- stylesheets as the importer resolved them, with asset references already rewritten
-- to this install's upload paths — so a theme can be re-activated without the
-- original package. That is also why uninstalling must take its assets with it.
CREATE TABLE "ncf_themes" (
    "id"              TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "version"         TEXT NOT NULL,
    "vendor"          TEXT NOT NULL,
    "manifest"        JSONB NOT NULL,
    "payload"         JSONB NOT NULL,
    "active"          BOOLEAN NOT NULL DEFAULT false,
    "installed_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at"    TIMESTAMP(3),
    "installed_by_id" TEXT,

    CONSTRAINT "ncf_themes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ncf_themes_active_idx" ON "ncf_themes"("active");
