-- Migration readiness (§34): legacy password schemes for platform migrations,
-- adapter fields on migration_runs, and the import_map resume/mapping table.

-- users: "argon2" (native) or a legacy scheme set by migration adapters
-- ("bcrypt", "phpass"); legacy hashes are verified on login then rehashed.
ALTER TABLE "User" ADD COLUMN "password_scheme" TEXT NOT NULL DEFAULT 'argon2';

-- migration_runs: §34 adapter-run fields; existing core-deploy log rows keep
-- working (adapter defaults to 'core', command/output/durationMs now optional).
ALTER TABLE "migration_runs" ALTER COLUMN "command" DROP NOT NULL;
ALTER TABLE "migration_runs" ALTER COLUMN "output" DROP NOT NULL;
ALTER TABLE "migration_runs" ALTER COLUMN "durationMs" DROP NOT NULL;
ALTER TABLE "migration_runs" ADD COLUMN "adapter" TEXT NOT NULL DEFAULT 'core';
ALTER TABLE "migration_runs" ADD COLUMN "adapter_ver" TEXT;
ALTER TABLE "migration_runs" ADD COLUMN "source_info" TEXT;
ALTER TABLE "migration_runs" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "migration_runs" ADD COLUMN "started_at" TIMESTAMP(3);
ALTER TABLE "migration_runs" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "migration_runs" ADD COLUMN "summary" JSONB;
ALTER TABLE "migration_runs" ADD COLUMN "errors" JSONB;
ALTER TABLE "migration_runs" ADD COLUMN "report_path" TEXT;

-- Source-entity -> Nodevo-entity mapping written during platform migrations:
-- makes re-runs resumable (skip imported source ids) and resolves references.
CREATE TABLE "import_map" (
  "id" TEXT NOT NULL,
  "run_id" TEXT,
  "platform" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "nodevo_id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_map_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "import_map_platform_entity_source_id_key" ON "import_map"("platform", "entity", "source_id");
CREATE INDEX "import_map_nodevo_id_idx" ON "import_map"("nodevo_id");
