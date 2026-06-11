/*
  Warnings:

  - You are about to drop the column `displayName` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "displayName",
ALTER COLUMN "avatar" DROP NOT NULL,
ALTER COLUMN "avatar" DROP DEFAULT,
ALTER COLUMN "bio" DROP NOT NULL,
ALTER COLUMN "bio" DROP DEFAULT,
ALTER COLUMN "username" DROP DEFAULT;
