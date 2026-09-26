-- Live progress + heartbeat for platform imports (ACP -> System -> Migration History).
ALTER TABLE "xcf_migration_runs" ADD COLUMN "progress" JSONB;
