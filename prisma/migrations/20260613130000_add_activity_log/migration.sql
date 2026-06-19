-- Unified activity log: public movements + ACP actions.
CREATE TABLE "ncf_activity_log" (
    "id"         TEXT NOT NULL,
    "category"   TEXT NOT NULL,
    "user_id"    TEXT,
    "username"   TEXT,
    "method"     TEXT,
    "path"       TEXT NOT NULL,
    "status"     INTEGER,
    "ip"         TEXT,
    "user_agent" TEXT,
    "meta"       JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncf_activity_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ncf_activity_log_category_created_at_idx" ON "ncf_activity_log"("category", "created_at" DESC);
CREATE INDEX "ncf_activity_log_user_id_idx" ON "ncf_activity_log"("user_id");
