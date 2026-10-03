-- Error log redesign: where an error happened as columns, a grouping key, and
-- the one decision the ACP stores about a group (resolved).
ALTER TABLE "xcf_error_log" ADD COLUMN "method" VARCHAR(16),
ADD COLUMN "url" TEXT,
ADD COLUMN "group_key" VARCHAR(32);

CREATE INDEX "xcf_error_log_group_key_created_at_idx" ON "xcf_error_log"("group_key", "created_at" DESC);
CREATE INDEX "xcf_error_log_created_at_idx" ON "xcf_error_log"("created_at");

CREATE TABLE "xcf_error_log_groups" (
    "key" VARCHAR(32) NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "resolved_by_id" TEXT,

    CONSTRAINT "xcf_error_log_groups_pkey" PRIMARY KEY ("key")
);
