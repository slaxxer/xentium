/**
 * While the site is in maintenance, a plugin keeps the routes machines call open
 * (other sites asking a store, webhooks); people still get the maintenance answer
 * everywhere else, the same plugin's other routes included.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../modules/maintenance/maintenance.service.js", () => ({
  maintenanceService: { isEnabled: async () => true, userMayBypass: async () => false },
}));
vi.mock("../../modules/auth/auth.tokens.js", () => ({ verifyAccess: async () => { throw new Error("no"); } }));

const { maintenanceGuard } = await import("./maintenanceGuard.js");
const { keepOpenDuringMaintenance, clearMaintenanceOpen } = await import("../../modules/maintenance/maintenanceOpenPaths.js");

const app = express();
app.use(maintenanceGuard);
app.use((_req, res) => { res.json({ ok: true }); });

afterEach(() => clearMaintenanceOpen("my-store"));

describe("routes kept open during maintenance", () => {
  it("lets the declared prefixes through, and nothing else", async () => {
    keepOpenDuringMaintenance("my-store", ["/v1", "/webhooks/"]);
    await request(app).get("/api/p/my-store/v1/catalog").expect(200);
    await request(app).get("/api/p/my-store/v1").expect(200);
    await request(app).post("/api/p/my-store/webhooks/paypal").expect(200);
    // The same plugin's pages for people, a look-alike prefix, another plugin, core.
    await request(app).get("/api/p/my-store/account/orders").expect(503);
    await request(app).get("/api/p/my-store/v10/x").expect(503);
    await request(app).get("/api/p/other/v1/catalog").expect(503);
    await request(app).get("/api/articles").expect(503);
  });

  it("closes them again when the plugin is disabled", async () => {
    keepOpenDuringMaintenance("my-store", ["/v1"]);
    clearMaintenanceOpen("my-store");
    await request(app).get("/api/p/my-store/v1/catalog").expect(503);
  });

  it("refuses a prefix that is not a path of its own routes", () => {
    for (const bad of ["/", "v1", "/../admin", "/v1?x=1"]) {
      expect(() => keepOpenDuringMaintenance("my-store", [bad])).toThrow();
    }
  });
});
