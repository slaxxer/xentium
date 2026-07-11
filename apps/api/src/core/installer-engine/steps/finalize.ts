import { generateKeyPairSync, randomUUID } from "node:crypto";
import { prisma } from "../../../infrastructure/db.js";
import { markInstalled } from "../../../shared/middleware/installGuard.js";
import { bustSettingsCache } from "../../../shared/utils/settings.js";

async function ensureKeyPair() {
  const existing = await prisma.setting.findUnique({ where: { key: "auth.jwtPrivateKey" } });
  if (existing) return;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await prisma.setting.createMany({
    data: [
      { key: "auth.jwtPrivateKey", value: privateKey },
      { key: "auth.jwtPublicKey", value: publicKey },
    ],
  });
}

export async function finalize(): Promise<{ siteId: string }> {
  await ensureKeyPair();

  const row = await prisma.install.findFirstOrThrow();
  const siteId = row.siteId ?? randomUUID();

  await prisma.install.update({
    where: { id: row.id },
    data: { siteId, completedAt: new Date(), currentStep: "COMPLETE" },
  });

  markInstalled(); // flip the guard cache; no restart needed
  bustSettingsCache(); // installer just seeded settings — drop any cached misses
  return { siteId };
}
