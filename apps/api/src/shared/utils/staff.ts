import { CorePermissions } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";

/**
 * The keys of the groups that hold `permKey` — for code that already has a user's
 * groups in hand and checks many users at once. One user? Use `hasPermission`.
 */
export async function groupKeysWith(permKey: string): Promise<Set<string>> {
  const rows = await prisma.group.findMany({
    where:  { permissions: { some: { permission: { key: permKey } } } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

/**
 * "Staff" — the groups holding `moderation.protected`. Configured in ACP →
 * Permissions; never a hardcoded list of group names.
 */
export function staffGroupKeys(): Promise<Set<string>> {
  return groupKeysWith(CorePermissions.MODERATION_PROTECTED);
}
