import { randomUUID } from "node:crypto";
import { prisma } from "../../../infrastructure/db.js";
import { markInstalled } from "../../../shared/middleware/installGuard.js";
import { bustSettingsCache } from "../../../shared/utils/settings.js";

export async function finalize(): Promise<{ siteId: string }> {
  // A finished install can't be reopened (the installer switches itself off), so
  // finishing one nobody can sign in to administer would strand the site.
  const admins = await prisma.userGroup.count({ where: { group: { key: "admin" } } });
  if (admins === 0) throw Object.assign(new Error("install_admin_missing"), { status: 409 });

  // (An RSA key pair used to be stored here as auth.jwtPrivateKey/PublicKey. Nothing
  // ever signed with it — tokens are HS256 with JWT_SECRET — so it is no longer made;
  // sites that have one keep the unused rows.)

  const row = await prisma.install.findUniqueOrThrow({ where: { singleton: true } });
  const siteId = row.siteId ?? randomUUID();

  await prisma.install.update({
    where: { id: row.id },
    data: { siteId, completedAt: new Date(), currentStep: "COMPLETE" },
  });

  markInstalled(); // flip the guard cache; no restart needed
  bustSettingsCache(); // installer just seeded settings — drop any cached misses
  return { siteId };
}
