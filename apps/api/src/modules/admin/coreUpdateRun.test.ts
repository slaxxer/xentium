/**
 * The API's half of one-click updates only ever writes a request. These pin what
 * it agrees to write: only for the right password, only the version the update
 * check offers, never while another run is going, and a rollback only after a
 * finished update.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const offered = vi.hoisted(() => ({ version: "1.0.0-alpha.99" as string | null }));
vi.mock("./marketplace.service.js", () => ({ offeredCoreVersion: async () => offered.version }));

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { hashPassword } = await import("../auth/auth.password.js");
const { XENTIUM_VERSION } = await import("../../config/version.js");
const { coreUpdateRun } = await import("./coreUpdateRun.js");

const P = "cuptest";
let site = "", run = "", userId = "";
const savedEnv = process.env.XENTIUM_ENV_FILE;

beforeAll(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  userId = (await prisma.user.create({ data: { email: `${P}@example.test`, username: P, passwordHash: await hashPassword("right-password") } })).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  process.env.XENTIUM_ENV_FILE = savedEnv;
});
beforeEach(() => {
  site = mkdtempSync(path.join(os.tmpdir(), "xt-site-"));
  run = path.join(site, "shared", "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(site, "shared", ".env"), "");
  process.env.XENTIUM_ENV_FILE = path.join(site, "shared", ".env");
  offered.version = "1.0.0-alpha.99";
});
afterEach(() => rmSync(site, { recursive: true, force: true }));

const withUpdater = () => writeFileSync(path.join(run, "updater.json"), "{}");
const status = (s: object) => writeFileSync(path.join(run, "update-status.json"), JSON.stringify({
  v: 1, id: "run-1", action: "update", from: "1.0.0-alpha.17", to: XENTIUM_VERSION, state: "running",
  requestedBy: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: null,
  steps: [], packages: [], otherPackages: null, migrations: [], backup: null, error: null, log: [], ...s,
}));

describe("availability", () => {
  it("is off without the updater, and on a clone", async () => {
    expect(await coreUpdateRun.view()).toMatchObject({ available: false, unavailableReason: "no-updater" });
    process.env.XENTIUM_ENV_FILE = "";
    expect(await coreUpdateRun.view()).toMatchObject({ available: false, unavailableReason: "not-cli-install" });
  });

  it("refuses to start without the updater", async () => {
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4091" });
  });
});

describe("start", () => {
  it("needs the right password", async () => {
    withUpdater();
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "wrong")).rejects.toMatchObject({ code: "XEC-UPDATE-4221", httpStatus: 422 });
    expect(existsSync(path.join(run, "update-request.json"))).toBe(false);
  });

  it("only asks for the offered version", async () => {
    withUpdater();
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.98", "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4093" });
    offered.version = null;
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4093" });
  });

  it("writes the request, then refuses a second one", async () => {
    withUpdater();
    const view = await coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password");
    expect(view.queued).toBe(true);
    const req = JSON.parse(readFileSync(path.join(run, "update-request.json"), "utf8"));
    expect(req).toMatchObject({ v: 1, action: "update", version: "1.0.0-alpha.99", requestedBy: { id: userId, username: P } });
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4092" });
  });

  it("refuses while a run is going, but not after one stalled", async () => {
    withUpdater();
    status({ state: "running" });
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4092" });
    status({ state: "running", updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() });
    expect((await coreUpdateRun.view()).stalled).toBe(true);
    await expect(coreUpdateRun.start(userId, "1.0.0-alpha.99", "right-password")).resolves.toMatchObject({ queued: true });
  });
});

describe("rollback", () => {
  it("only after a finished update to the running version", async () => {
    withUpdater();
    await expect(coreUpdateRun.rollback(userId, "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4094" });
    status({ state: "failed" });
    await expect(coreUpdateRun.rollback(userId, "right-password")).rejects.toMatchObject({ code: "XEC-UPDATE-4094" });
    status({ state: "done" });
    await coreUpdateRun.rollback(userId, "right-password");
    expect(JSON.parse(readFileSync(path.join(run, "update-request.json"), "utf8"))).toMatchObject({ action: "rollback", version: "1.0.0-alpha.17" });
  });
});
