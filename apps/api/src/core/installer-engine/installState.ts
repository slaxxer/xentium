import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { InstallStep } from "@xentium/contracts";

/** Singleton row. Created the moment migrations succeed in the DATABASE step. */
export async function getInstall() {
  return prisma.install.findFirst();
}

/**
 * The siteId is minted HERE rather than in finalize, because the ADD-ONS step
 * talks to the marketplace and `getSiteId()` is what a licence binds to — an
 * install that cannot name itself cannot link an account or pass the download
 * gate. Minting it at row creation gives every install its own identity from
 * the DATABASE step onward, which is the hazard that guard was written for; a
 * half-finished install simply has a real id like any other.
 *
 * finalize still reads `row.siteId ?? randomUUID()`, so a row created before
 * this change (a resumed install) still gets one.
 */
export async function ensureInstallRow(step: InstallStep) {
  const existing = await prisma.install.findFirst();
  if (existing) return existing;
  return prisma.install.create({ data: { currentStep: step, siteId: randomUUID() } });
}

export async function advanceTo(step: InstallStep) {
  const row = await prisma.install.findFirst();
  if (!row) throw new Error("install_row_missing");
  return prisma.install.update({ where: { id: row.id }, data: { currentStep: step } });
}

export async function assertNotComplete() {
  let row;
  try {
    row = await prisma.install.findFirst();
  } catch {
    // Fresh database: the installs table doesn't exist until the DATABASE
    // step runs `migrate deploy`. No table = definitely not complete.
    return;
  }
  if (row?.completedAt) {
    const err = new Error("already_installed");
    (err as any).status = 410;
    throw err;
  }
}
