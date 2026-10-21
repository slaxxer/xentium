import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";

// Mock the migration shell-out; the schema is applied by CI before tests run.
vi.mock("../../core/installer-engine/steps/runMigrations.js", () => ({
  runMigrations: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../infrastructure/db.js";
import { __resetInstalledCache } from "../../shared/middleware/installGuard.js";
import { buildApp, resetDb, ADMIN, SITE } from "./installer.testkit.js";

let app: Express;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  await resetDb();
  __resetInstalledCache();
});

describe("install guard", () => {
  it("blocks feature routes before install with 503", async () => {
    const res = await request(app).get("/api/protected");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "not_installed" });
  });

  it("always allows health and installer status before install", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
    const status = await request(app).get("/api/install/status");
    expect(status.status).toBe(200);
    expect(status.body.installed).toBe(false);
    expect(status.body.currentStep).toBe("WELCOME");
  });
});

describe("installer happy path", () => {
  it("walks the wizard, seeds RBAC, mints the admin, and self-disables", async () => {
    // Step 3 — database: migrate (mocked) + seed core perms/groups.
    const db = await request(app).post("/api/install/database").send({});
    expect(db.status).toBe(200);
    expect(db.body.currentStep).toBe("SITE_CONFIG");

    const groups = await prisma.group.findMany({ select: { key: true } });
    expect(groups.map((g) => g.key).sort()).toEqual(["admin", "member", "moderator", "supermod"]);

    const adminGroup = await prisma.group.findUniqueOrThrow({ where: { key: "admin" } });
    const adminPermCount = await prisma.groupPermission.count({ where: { groupId: adminGroup.id } });
    const totalPerms = await prisma.permission.count();
    expect(adminPermCount).toBe(totalPerms); // admin holds every core permission

    // Step 4 — site config.
    const site = await request(app).post("/api/install/site").send(SITE);
    expect(site.status).toBe(200);
    expect(site.body.currentStep).toBe("ADDONS");
    const siteName = await prisma.setting.findUnique({ where: { key: "site.name" } });
    expect(siteName?.value).toBe(SITE.siteName);

    // Step 5 — add-ons. The catalogue needs no marketplace to answer: an
    // unreachable one is a state the step renders, not an error it throws.
    const catalogue = await request(app).get("/api/install/addons");
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.connected).toBe(false);
    expect(catalogue.body.selected).toEqual([]);

    // Skipping the step is a selection of nothing, not a step that was not taken.
    const addons = await request(app).post("/api/install/addons").send({ pluginIds: [] });
    expect(addons.status).toBe(200);
    expect(addons.body.currentStep).toBe("ADMIN");

    // Step 6 — admin account.
    const admin = await request(app).post("/api/install/admin").send(ADMIN);
    expect(admin.status).toBe(200);
    expect(admin.body.currentStep).toBe("FINALIZE");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toContain(ADMIN.password); // hashed, never plaintext
    const membership = await prisma.userGroup.findFirst({
      where: { userId: user.id, groupId: adminGroup.id },
    });
    expect(membership).not.toBeNull();

    // Step 7 — finalize: keys, site id, completedAt.
    const fin = await request(app).post("/api/install/finalize").send({});
    expect(fin.status).toBe(200);
    expect(fin.body.currentStep).toBe("COMPLETE");
    expect(fin.body.siteId).toMatch(/^[0-9a-f-]{36}$/);

    const install = await prisma.install.findFirstOrThrow();
    expect(install.completedAt).not.toBeNull();
    expect(install.siteId).toBe(fin.body.siteId);
    const priv = await prisma.setting.findUnique({ where: { key: "auth.jwtPrivateKey" } });
    expect(priv?.value).toContain("BEGIN PRIVATE KEY");

    // Self-removal: status still readable, mutating routes gone, app unlocked.
    const statusAfter = await request(app).get("/api/install/status");
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.installed).toBe(true);

    const reRun = await request(app).post("/api/install/database").send({});
    expect(reRun.status).toBe(410);
    expect(reRun.body).toEqual({ error: "install_disabled" });

    expect((await request(app).get("/api/protected")).status).toBe(200);
    // The whole wizard: seeding every permission and group plus an argon2 hash. Close
    // to vitest's 5 s default on a CI runner, where it timed out once.
  }, 20_000);

  it("refuses to mutate once already complete (assertNotComplete)", async () => {
    await request(app).post("/api/install/database").send({});
    await request(app).post("/api/install/site").send(SITE);
    await request(app).post("/api/install/addons").send({ pluginIds: [] });
    await request(app).post("/api/install/admin").send(ADMIN);
    await request(app).post("/api/install/finalize").send({});

    // markInstalled() flipped the cache; but even a fresh cache must 410 on mutation.
    __resetInstalledCache();
    const res = await request(app).post("/api/install/finalize").send({});
    expect(res.status).toBe(410);
  });
});
