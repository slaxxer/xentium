-- Sync schema objects that were applied to dev via `prisma db push` but never
-- captured in a migration. Without this, `prisma migrate reset` / `migrate
-- deploy` (i.e. every fresh/production install) builds an INCOMPLETE schema —
-- plugin installs fail because `nodevo_plugin_migrations` is missing, style
-- packs fail (`installed_style_packs`), plugin nav items fail (nav_items.
-- plugin_id), and moderation case notes have nowhere to live.
--
-- Only additive, functional drift is included here. Deliberately omitted:
--   * DROP of User/articles `search_vector` + GIN indexes — those are managed
--     by raw-SQL trigger migrations and are NOT modelled in schema.prisma.
--   * Cosmetic constraint/index renames.

-- CreateTable
CREATE TABLE "nodevo_plugin_migrations" (
    "id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "plugin_ver" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksum" TEXT NOT NULL,
    "direction" TEXT NOT NULL,

    CONSTRAINT "nodevo_plugin_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nodevo_plugin_migrations_plugin_id_idx" ON "nodevo_plugin_migrations"("plugin_id");

-- CreateTable
CREATE TABLE "installed_style_packs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'community',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "light_css" TEXT NOT NULL,
    "dark_css" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_by" TEXT NOT NULL,

    CONSTRAINT "installed_style_packs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "nav_items" ADD COLUMN "plugin_id" TEXT;

-- AlterTable
ALTER TABLE "moderation_cases" ADD COLUMN "notes" TEXT;

-- AddForeignKey
ALTER TABLE "profile_comments" ADD CONSTRAINT "profile_comments_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
