import { prisma } from "../../infrastructure/db.js";

/** Read a single setting from the DB, returning `defaultValue` if not set. */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row === null) return defaultValue;
  return (row.value as unknown) as T;
}
