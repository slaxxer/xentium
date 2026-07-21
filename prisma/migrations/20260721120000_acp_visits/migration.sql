-- Durable per-user page-visit marks (dialog acknowledgment state).
-- Split out of ncf_activity_log so the log-retention job can prune telemetry
-- without silently un-acknowledging the ACP-entry dialogs.
CREATE TABLE "ncf_acp_visits" (
    "user_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "last_visit_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncf_acp_visits_pkey" PRIMARY KEY ("user_id", "path")
);

-- Backfill from existing page_visit telemetry so acknowledgments already earned
-- (admin visited /admin/updates or /admin/license) survive the storage switch.
INSERT INTO "ncf_acp_visits" ("user_id", "path", "last_visit_at")
SELECT "user_id", "path", MAX("created_at")
FROM "ncf_activity_log"
WHERE "category" = 'page_visit' AND "user_id" IS NOT NULL
GROUP BY "user_id", "path";
