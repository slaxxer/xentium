-- Custom emojis an admin uploads (ACP → Content → Emojis). Retired rows keep their file,
-- so posts that used one keep showing it.
CREATE TABLE "xcf_emojis" (
    "id" TEXT NOT NULL,
    "shortcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "retired_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_emojis_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_emojis_shortcode_key" ON "xcf_emojis"("shortcode");
CREATE INDEX "xcf_emojis_retired_at_category_position_idx" ON "xcf_emojis"("retired_at", "category", "position");
