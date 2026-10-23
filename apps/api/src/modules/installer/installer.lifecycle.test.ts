/**
 * The installer as a state machine, not a happy path: what it refuses, what it
 * survives, and what it does when two requests arrive at once.
 *
 * What must hold:
 *  - no step runs before its turn, from any state, and finishing needs an admin;
 *  - going back and submitting an earlier step again works and never moves the
 *    install backwards;
 *  - a step that fails leaves nothing half-done and can simply be run again;
 *  - concurrent requests make one install row with one siteId, and finish once;
 *  - a finished install refuses every step.
 */
import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";

// Mock the migration shell-out; the schema is applied before tests run.
vi.mock("../../core/installer-engine/steps/runMigrations.js", () => ({
  runMigrations: vi.fn().mockResolvedValue(undefined),
}));
// This file sends far more than the installer's 60 requests a minute.
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { prisma } from "../../infrastructure/db.js";
import { __resetInstalledCache } from "../../shared/middleware/installGuard.js";
import { runMigrations } from "../../core/installer-engine/steps/runMigrations.js";
import { buildApp, resetDb, ADMIN, SITE } from "./installer.testkit.js";

let app: Express;
beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await resetDb();
  __resetInstalledCache();
  vi.mocked(runMigrations).mockReset().mockResolvedValue(undefined);
});

const OUT_OF_ORDER = { error: "install_step_out_of_order" };

// One entry per step that changes the install, in wizard order.
const STEPS = {
  database: () => request(app).post("/api/install/database").send({}),
  site:     () => request(app).post("/api/install/site").send(SITE),
  addons:   () => request(app).post("/api/install/addons").send({ pluginIds: [] }),
  admin:    () => request(app).post("/api/install/admin").send(ADMIN),
  finalize: () => request(app).post("/api/install/finalize").send({}),
};
type StepName = keyof typeof STEPS;
const ORDER = Object.keys(STEPS) as StepName[];

/** Run the wizard up to and including `last`, asserting each step succeeds. */
async function walkTo(last: StepName) {
  for (const name of ORDER.slice(0, ORDER.indexOf(last) + 1)) {
    const res = await STEPS[name]();
    expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
  }
}

const status = async () => (await request(app).get("/api/install/status")).body;
const installRows = () => prisma.install.count();

describe("installer lifecycle: order", () => {
  it("refuses every later step on a fresh database, and creates nothing", async () => {
    for (const name of ORDER.slice(1)) {
      const res = await STEPS[name]();
      expect(res.status, name).toBe(409);
      expect(res.body, name).toEqual(OUT_OF_ORDER);
    }
    expect((await request(app).get("/api/install/addons")).status).toBe(409);
    expect((await request(app).post("/api/install/marketplace/link")).status).toBe(409);
    expect(await installRows()).toBe(0);
    expect((await status()).currentStep).toBe("WELCOME");
  });

  it("refuses to skip ahead from every step it can be on", async () => {
    for (const [i, reached] of ORDER.slice(0, -1).entries()) {
      await resetDb();
      __resetInstalledCache();
      await walkTo(reached);
      // Everything two or more steps ahead is refused; the next one is allowed.
      for (const ahead of ORDER.slice(i + 2)) {
        const res = await STEPS[ahead]();
        expect(res.status, `${ahead} after ${reached}`).toBe(409);
      }
    }
  });

  it("won't finish an install nobody can administer", async () => {
    await walkTo("addons");
    // Even with the step forced to FINALIZE, there is no admin yet.
    await prisma.install.update({ where: { singleton: true }, data: { currentStep: "FINALIZE" } });

    const res = await STEPS.finalize();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "install_admin_missing" });
    const s = await status();
    expect(s.installed).toBe(false);
    // ...and the installer is still there to fix it.
    expect((await STEPS.admin()).status).toBe(200);
    expect((await STEPS.finalize()).status).toBe(200);
  });

  it("accepts an earlier step again without moving the install backwards", async () => {
    await walkTo("admin");
    const { siteId } = await status();

    const renamed = await request(app).post("/api/install/site").send({ ...SITE, siteName: "Renamed" });
    expect(renamed.status).toBe(200);
    expect((await STEPS.database()).status).toBe(200);
    expect((await STEPS.addons()).status).toBe(200);

    const s = await status();
    expect(s.currentStep).toBe("FINALIZE");
    expect(s.siteId).toBe(siteId);
    expect((await prisma.setting.findUnique({ where: { key: "site.name" } }))?.value).toBe("Renamed");
    expect(await installRows()).toBe(1);
  });
});

describe("installer lifecycle: failure and retry", () => {
  it("a failed database step leaves no install behind and runs again cleanly", async () => {
    vi.mocked(runMigrations).mockRejectedValueOnce(new Error("migrate deploy failed"));

    const failed = await STEPS.database();
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: "migrate deploy failed" });
    expect(await installRows()).toBe(0);
    expect((await status()).currentStep).toBe("WELCOME");
    expect((await STEPS.site()).status).toBe(409);

    expect((await STEPS.database()).status).toBe(200);
    expect((await status()).currentStep).toBe("SITE_CONFIG");
  });

  it("a failed install run can be run again from the admin step", async () => {
    await walkTo("admin");
    // The wizard's retry repeats the admin step before finalizing.
    expect((await STEPS.admin()).status).toBe(200);
    expect(await prisma.user.count({ where: { email: ADMIN.email } })).toBe(1);
    expect((await STEPS.finalize()).status).toBe(200);
    expect((await status()).installed).toBe(true);
  });

  it("refuses a database URL instead of ignoring it", async () => {
    const res = await request(app).post("/api/install/database").send({ databaseUrl: "postgresql://elsewhere/db" });
    expect(res.status).toBe(400);
    expect(await installRows()).toBe(0);
  });
});

describe("installer lifecycle: concurrency", () => {
  it("concurrent database steps make one install with one siteId", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => STEPS.database()));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await installRows()).toBe(1);
    const { siteId } = await status();
    expect(siteId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await STEPS.database()).status).toBe(200);
    expect((await status()).siteId).toBe(siteId);
  });

  it("concurrent finalizes finish the install exactly once", async () => {
    await walkTo("admin");
    const results = await Promise.all(Array.from({ length: 3 }, () => STEPS.finalize()));
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
    const winner = results.find((r) => r.status === 200)!;
    expect((await status()).siteId).toBe(winner.body.siteId);
    expect(await prisma.install.count()).toBe(1);
  });

  it("the database refuses a second install row", async () => {
    await walkTo("database");
    await expect(prisma.install.create({ data: { currentStep: "WELCOME" } })).rejects.toThrow();
  });
});

describe("installer lifecycle: after completion", () => {
  it("every step is closed, through the guard and without its cache", async () => {
    await walkTo("finalize");
    for (const cached of [true, false]) {
      if (!cached) __resetInstalledCache();
      for (const name of ORDER) {
        expect((await STEPS[name]()).status, `${name} (cache ${cached})`).toBe(410);
      }
    }
    expect((await request(app).get("/api/protected")).status).toBe(200);
  });

  it("an install finished by ANOTHER process opens this one without a restart", async () => {
    await walkTo("admin");
    // This process has seen the site uninstalled…
    expect((await request(app).get("/api/protected")).status).toBe(503);
    // …and another API instance finishes the install (straight in the database here).
    await prisma.install.update({ where: { singleton: true }, data: { completedAt: new Date(), currentStep: "COMPLETE" } });
    expect((await request(app).get("/api/protected")).status).toBe(200);
  });
});
