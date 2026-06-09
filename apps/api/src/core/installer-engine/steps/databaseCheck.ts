import { prisma } from "../../../infrastructure/db.js";

export async function databaseCheck(_databaseUrl?: string): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
