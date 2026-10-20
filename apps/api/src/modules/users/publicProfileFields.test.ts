/**
 * A profile's public field list against the real test database.
 *
 * What must hold: the date of birth never appears in it (the profile's own `dob`
 * shows it the way the member chose in Account → Privacy, or not at all), while
 * the admin's other fields do, within each answer's own privacy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { userService: usersService } = await import("./users.service.js");

const EMAIL = "ppf@ppftest.example";
let userId: string;
const fieldIds: string[] = [];

async function cleanup() {
  await prisma.userProfileFieldValue.deleteMany({ where: { fieldId: { in: fieldIds } } });
  await prisma.userProfileField.deleteMany({ where: { key: { startsWith: "ppf_" } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}
beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "ppf_member", passwordHash: "x", dobDisplay: "hidden" } })).id;
  const dob = await prisma.userProfileField.upsert({
    where: { key: "date_of_birth" }, update: {},
    create: { key: "date_of_birth", label: "Date of Birth", type: "date", isSystem: true },
  });
  const game = await prisma.userProfileField.create({ data: { key: "ppf_game", label: "Game", type: "text", showOnProfile: true } });
  const secret = await prisma.userProfileField.create({ data: { key: "ppf_secret", label: "Secret", type: "text", showOnProfile: true } });
  fieldIds.push(game.id, secret.id);
  await prisma.userProfileFieldValue.createMany({
    data: [
      { userId, fieldId: dob.id, value: "1990-05-01", privacy: "public" },
      { userId, fieldId: game.id, value: "Chess", privacy: "public" },
      { userId, fieldId: secret.id, value: "x", privacy: "nobody" },
    ],
  });
});
afterEach(async () => {
  await prisma.userProfileFieldValue.deleteMany({ where: { userId } });
  await cleanup();
});

describe("public profile fields", () => {
  it("never lists the date of birth, even when its answer is public", async () => {
    const fields = await usersService.getUserPublicProfileFields(userId, true);
    expect(fields.map((f) => f.key)).not.toContain("date_of_birth");
  });

  it("lists the admin's other fields, within each answer's privacy", async () => {
    const fields = await usersService.getUserPublicProfileFields(userId, false);
    expect(fields.map((f) => f.key)).toContain("ppf_game");
    expect(fields.map((f) => f.key)).not.toContain("ppf_secret");
  });
});
