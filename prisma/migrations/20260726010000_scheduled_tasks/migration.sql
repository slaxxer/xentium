-- Admin-created scheduled tasks. The predefined SCHEDULED_JOBS stay code-owned
-- (an admin only changes when they run); these rows are admin-composed:
-- an action key from the core registry + validated params + a schedule.
CREATE TABLE "ncf_scheduled_tasks" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "action_key"    TEXT NOT NULL,
  "params"        JSONB NOT NULL DEFAULT '{}',
  "schedule"      JSONB NOT NULL,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "dry_run"       BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "last_run_at"   TIMESTAMP(3),
  "last_status"   TEXT,
  CONSTRAINT "ncf_scheduled_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ncf_scheduled_tasks_enabled_idx" ON "ncf_scheduled_tasks"("enabled");

-- Per-run history. Pruned by the existing log-retention job rather than owning
-- a cleanup path of its own.
CREATE TABLE "ncf_scheduled_task_runs" (
  "id"          TEXT NOT NULL,
  "task_id"     TEXT NOT NULL,
  "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "status"      TEXT NOT NULL,
  "dry_run"     BOOLEAN NOT NULL DEFAULT false,
  "summary"     TEXT,
  "error"       TEXT,
  CONSTRAINT "ncf_scheduled_task_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ncf_scheduled_task_runs_task_id_started_at_idx"
  ON "ncf_scheduled_task_runs"("task_id", "started_at");

ALTER TABLE "ncf_scheduled_task_runs"
  ADD CONSTRAINT "ncf_scheduled_task_runs_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "ncf_scheduled_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
