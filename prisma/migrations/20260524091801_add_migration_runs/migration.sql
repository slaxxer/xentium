-- CreateTable
CREATE TABLE "migration_runs" (
    "id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);
