-- CreateTable
CREATE TABLE "group_progression" (
    "group_id" TEXT NOT NULL,
    "is_progression_group" BOOLEAN NOT NULL DEFAULT false,
    "ladder_position" INTEGER,
    "promote_from_group_id" TEXT,
    "min_posts" INTEGER,
    "min_threads" INTEGER,
    "min_days_member" INTEGER,
    "min_likes_received" INTEGER,
    "max_post_length" INTEGER,
    "max_daily_posts" INTEGER,
    "max_attachments" INTEGER,
    "max_profile_image_bytes" INTEGER,
    "allowed_profile_image_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "badge_label" TEXT,
    "badge_color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_progression_pkey" PRIMARY KEY ("group_id")
);

-- CreateIndex
CREATE INDEX "group_progression_is_progression_group_ladder_position_idx" ON "group_progression"("is_progression_group", "ladder_position");

-- AddForeignKey
ALTER TABLE "group_progression" ADD CONSTRAINT "group_progression_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
