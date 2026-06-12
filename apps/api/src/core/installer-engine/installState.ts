import { prisma } from "../../infrastructure/db.js";
import { InstallStep } from "@nodevo/contracts";

/** Singleton row. Created the moment migrations succeed in the DATABASE step. */
export async function getInstall() {
  return prisma.install.findFirst();
}

export async function ensureInstallRow(step: InstallStep) {
  const existing = await prisma.install.findFirst();
  if (existing) return existing;
  return prisma.install.create({ data: { currentStep: step } });
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
