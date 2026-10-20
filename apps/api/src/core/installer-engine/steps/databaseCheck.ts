import { prisma } from "../../../infrastructure/db.js";

export async function databaseCheck(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
