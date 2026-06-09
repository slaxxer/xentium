-- AlterTable
ALTER TABLE "User" ADD COLUMN     "article_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "follower_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "following_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "like_count_received" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "post_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thread_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "username_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "username_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "old_username" TEXT NOT NULL,
    "new_username" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" TEXT NOT NULL,

    CONSTRAINT "username_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_comments" (
    "id" TEXT NOT NULL,
    "profile_user_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "deleted_reason" TEXT,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_comment_likes" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profile_fields" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "placeholder" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "show_on_registration" BOOLEAN NOT NULL DEFAULT false,
    "required_on_registration" BOOLEAN NOT NULL DEFAULT false,
    "show_on_profile" BOOLEAN NOT NULL DEFAULT true,
    "dob_display_format" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profile_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profile_field_values" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "privacy" TEXT NOT NULL DEFAULT 'public',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profile_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_privacy_settings" (
    "user_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "username_history_user_id_idx" ON "username_history"("user_id");

-- CreateIndex
CREATE INDEX "user_follows_follower_id_idx" ON "user_follows"("follower_id");

-- CreateIndex
CREATE INDEX "user_follows_following_id_idx" ON "user_follows"("following_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_follows_follower_id_following_id_key" ON "user_follows"("follower_id", "following_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocker_id_idx" ON "user_blocks"("blocker_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "profile_comments_profile_user_id_deleted_at_created_at_idx" ON "profile_comments"("profile_user_id", "deleted_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "profile_comment_likes_comment_id_user_id_key" ON "profile_comment_likes"("comment_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_fields_key_key" ON "user_profile_fields"("key");

-- CreateIndex
CREATE INDEX "user_profile_field_values_user_id_idx" ON "user_profile_field_values"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_field_values_user_id_field_id_key" ON "user_profile_field_values"("user_id", "field_id");
