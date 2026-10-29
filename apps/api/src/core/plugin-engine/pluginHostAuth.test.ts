/** `host.auth`: a plugin re-checks who is asking, by core's own password rules. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { hashPassword } from "../../modules/auth/auth.password.js";
import { PluginContextImpl } from "./plugin-context.js";

const P = "hostauth";
const clean = () => prisma.user.deleteMany({ where: { username: { startsWith: P } } });
let withPw = ""; let withoutPw = "";

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  withPw = (await prisma.user.create({ data: { username: `${P}_a`, email: `${P}a@example.test`, passwordHash: await hashPassword("correct horse battery") } })).id;
  withoutPw = (await prisma.user.create({ data: { username: `${P}_b`, email: `${P}b@example.test`, passwordHash: "!oauth:github" } })).id;
});
afterEach(clean);

describe("plugin host: auth", () => {
  const host = new PluginContextImpl("auth-probe").host;

  it("accepts the right password and refuses a wrong one", async () => {
    expect(await host.auth.verifyPassword(withPw, "correct horse battery")).toBe(true);
    expect(await host.auth.verifyPassword(withPw, "wrong")).toBe(false);
    expect(await host.auth.hasPassword(withPw)).toBe(true);
  });

  it("never verifies an account that has no password", async () => {
    expect(await host.auth.verifyPassword(withoutPw, "!oauth:github")).toBe(false);
    expect(await host.auth.hasPassword(withoutPw)).toBe(false);
  });

  it("offers core's step-up check", () => {
    expect(typeof host.middleware.requireStepUp).toBe("function");
  });
});
