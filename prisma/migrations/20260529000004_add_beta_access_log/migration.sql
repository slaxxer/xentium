CREATE TABLE "beta_access_log" (
  "id"         TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "beta_code"  TEXT,
  "user_id"    TEXT,
  "username"   TEXT,
  "url"        TEXT,
  "ip"         TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "beta_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "beta_access_log_created_at_idx" ON "beta_access_log"("created_at" DESC);
