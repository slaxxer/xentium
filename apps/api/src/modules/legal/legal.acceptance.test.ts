/**
 * Who must accept which legal document: a published document marked "must be
 * accepted" is asked of every member once, and again when the admin raises its
 * revision for their group (or everyone). Accepting records the current revision.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { legalService } from "./legal.service.js";

const P = "lgacc";
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
let modId = "", memberGroup = "", modGroup = "", member = "", mod = "";

async function clean() {
  await prisma.legalDocument.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { key: { startsWith: P } } });
}

async function publish(key: "terms" | "privacy" | "imprint", must: boolean) {
  await legalService.saveDraft(key, doc(key), null as unknown as string);
  await legalService.publish(key, null as unknown as string);
  await legalService.setRequireAcceptance(key, must, null as unknown as string);
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  memberGroup = (await prisma.group.create({ data: { key: `${P}_member`, name: "M" } })).id;
  modGroup = (await prisma.group.create({ data: { key: `${P}_mod`, name: "Mod" } })).id;
  const user = async (s: string, g: string) => {
    const u = await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } });
    await prisma.userGroup.create({ data: { userId: u.id, groupId: g } });
    return u.id;
  };
  member = await user("member", memberGroup);
  mod = await user("mod", modGroup);
  modId = mod;
});
afterEach(clean);

describe("legal acceptance", () => {
  it("asks only for published documents marked must-accept, in footer order", async () => {
    await publish("imprint", false);
    expect(await legalService.pendingFor(member)).toEqual([]);
    await publish("terms", true);
    await publish("privacy", true);
    expect(await legalService.pendingFor(member)).toEqual(["privacy", "terms"]);
    expect((await legalService.listPublished()).find((d) => d.key === "terms")?.mustAccept).toBe(true);
    expect(await legalService.consentRequired()).toBe(true);
  });

  it("accepting one document on its page leaves the others", async () => {
    await publish("terms", true);
    await publish("privacy", true);
    expect(await legalService.accept(member, ["terms"])).toEqual(["privacy"]);
    expect(await legalService.accept(member)).toEqual([]);
  });

  it("asking again for a group reaches only that group, then clears on accepting", async () => {
    await publish("terms", true);
    await legalService.accept(member);
    await legalService.accept(mod);
    await legalService.askAgain("terms", [modGroup], modId);
    expect(await legalService.pendingFor(member)).toEqual([]);
    expect(await legalService.pendingFor(mod)).toEqual(["terms"]);
    const terms = (await legalService.listAll()).find((d) => d.key === "terms")!;
    expect(terms).toMatchObject({ revision: 2, reacceptGroupIds: [modGroup] });
    expect(terms.pendingCount).toBeGreaterThanOrEqual(1);
    await legalService.accept(mod, ["terms"]);
    expect(await legalService.pendingFor(mod)).toEqual([]);
  });

  it("asking again for everyone reaches every member", async () => {
    await publish("terms", true);
    await legalService.accept(member);
    await legalService.askAgain("terms", [], modId);
    expect(await legalService.pendingFor(member)).toEqual(["terms"]);
  });

  it("refuses to ask for a document that isn't published or required", async () => {
    await publish("imprint", false);
    await expect(legalService.askAgain("imprint", [], modId)).rejects.toMatchObject({ httpStatus: 409, code: "XEC-LEGAL-3503" });
    await expect(legalService.askAgain("terms", [], modId)).rejects.toMatchObject({ httpStatus: 409 });
    await publish("terms", true);
    await expect(legalService.askAgain("terms", ["nope"], modId)).rejects.toMatchObject({ httpStatus: 422 });
  });
});
