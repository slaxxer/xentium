-- One-time "level up" dialog: rungs a member climbed and has not seen yet.
CREATE TABLE "xcf_level_ups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_group_id" TEXT,
    "to_group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMP(3),

    CONSTRAINT "xcf_level_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xcf_level_ups_user_id_seen_at_idx" ON "xcf_level_ups"("user_id", "seen_at");

ALTER TABLE "xcf_level_ups" ADD CONSTRAINT "xcf_level_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
