/** Per-person UI flags: set, idempotent, cleared, and only a person's own. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { getUiFlags, setUiFlag } from "./uiFlags.js";

const EMAIL = "uiflags-probe@example.test";
let userId: string;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "uiflags_probe", passwordHash: "x" } })).id;
});
afterEach(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); });

describe("ui flags", () => {
  it("starts empty, sets a flag once however often it is set, and clears it", async () => {
    expect(await getUiFlags(userId)).toEqual([]);
    await setUiFlag(userId, "tour:theme-studio", true);
    await setUiFlag(userId, "tour:theme-studio", true);
    expect(await getUiFlags(userId)).toEqual(["tour:theme-studio"]);
    await setUiFlag(userId, "layout:advanced", true);
    await setUiFlag(userId, "tour:theme-studio", false);
    expect(await getUiFlags(userId)).toEqual(["layout:advanced"]);
  });
});
