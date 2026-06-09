/*
  Warnings:

  - You are about to drop the `Install` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Install";

-- CreateTable
CREATE TABLE "installs" (
    "id" TEXT NOT NULL,
    "currentStep" TEXT NOT NULL DEFAULT 'WELCOME',
    "completedAt" TIMESTAMP(3),
    "siteId" TEXT,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installs_pkey" PRIMARY KEY ("id")
);
