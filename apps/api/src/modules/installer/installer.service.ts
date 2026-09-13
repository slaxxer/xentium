import { prisma } from "../../infrastructure/db.js";
import { hashPassword } from "../auth/auth.password.js";
import { createSession } from "../auth/auth.tokens.js";
import { InstallStep, type InstallStatusDto } from "@xentium/contracts";
import { environmentCheck } from "../../core/installer-engine/steps/environmentCheck.js";
import { databaseCheck } from "../../core/installer-engine/steps/databaseCheck.js";
import { runMigrations } from "../../core/installer-engine/steps/runMigrations.js";
import { seedCore } from "../../core/installer-engine/steps/seedCore.js";
import { finalize } from "../../core/installer-engine/steps/finalize.js";
import { ensureInstallRow, advanceTo, assertNotComplete, getInstall }
  from "../../core/installer-engine/installState.js";
import type { SiteConfigInput, AdminAccountInput } from "@xentium/contracts";

type Meta = { ip?: string; userAgent?: string; deviceCookieId?: string };

export const installerService = {
  async status(): Promise<InstallStatusDto> {
    const row = await getInstall().catch(() => null);
    return {
      installed: !!row?.completedAt,
      currentStep: (row?.currentStep as InstallStep) ?? InstallStep.WELCOME,
      siteId: row?.siteId ?? null,
      // The full app is running, so the pre-env setup server is gone. The
      // wizard polls this flag after POST /install/setup to detect the swap.
      setupMode: false,
    };
  },

  environment: () => environmentCheck(),

  async configureDatabase(databaseUrl?: string) {
    await assertNotComplete();
    await databaseCheck(databaseUrl); // verify first
    await runMigrations(); // schema now exists
    await seedCore(); // perms + groups
    await ensureInstallRow(InstallStep.SITE_CONFIG);
    return { currentStep: InstallStep.SITE_CONFIG };
  },

  async testDatabase() {
    await assertNotComplete();
    await databaseCheck(); // SELECT 1, no migration
    return { ok: true };
  },

  async configureSite(input: SiteConfigInput) {
    await assertNotComplete();
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: "site.name" },
        update: { value: input.siteName },
        create: { key: "site.name", value: input.siteName },
      }),
      prisma.setting.upsert({
        where: { key: "site.url" },
        update: { value: input.siteUrl },
        create: { key: "site.url", value: input.siteUrl },
      }),
      prisma.setting.upsert({
        where: { key: "site.locale" },
        update: { value: input.locale },
        create: { key: "site.locale", value: input.locale },
      }),
      // Add this block:
      prisma.setting.upsert({
        where: { key: "site.timezone" },
        update: { value: input.timezone },
        create: { key: "site.timezone", value: input.timezone },
      }),
    ]);
    await advanceTo(InstallStep.ADMIN);
    return { currentStep: InstallStep.ADMIN };
  },

  async createAdmin(input: AdminAccountInput, meta: Meta) {
    await assertNotComplete();
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.$transaction(async (tx) => {
      const admin = await tx.group.findUniqueOrThrow({ where: { key: "admin" } });
      const u = await tx.user.upsert({
        where: { email: input.email },
        update: { username: input.username, passwordHash },
        create: { email: input.email, username: input.username, passwordHash, isActive: true },
      });
      await tx.userGroup.upsert({
        where: { userId_groupId: { userId: u.id, groupId: admin.id } },
        update: {},
        create: { userId: u.id, groupId: admin.id },
      });
      return u;
    });
    await advanceTo(InstallStep.FINALIZE);
    // Issue a session immediately so the browser gets a refresh cookie —
    // the admin is logged in as soon as installation completes.
    const tokens = await createSession(user.id, meta);
    return { currentStep: InstallStep.FINALIZE, ...tokens };
  },

  async finalize() {
    await assertNotComplete();
    const { siteId } = await finalize();
    return { currentStep: InstallStep.COMPLETE, siteId };
  },
};
