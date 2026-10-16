/**
 * A notification sent as a translation keeps its key + values beside the English
 * text, so the bell can show it in the reader's language and fall back to the text.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { notificationService } from "./notification.service.js";

const EMAIL = "notify_i18n@example.test";
let userId: string;

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  assertDisposableDatabase();
  await cleanup();
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "notify_i18n", passwordHash: "x" } })).id;
});
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId } });
  await cleanup();
});

describe("notification text", () => {
  it("stores the translation key and values with the English fallback", async () => {
    await notificationService.dispatch({
      userId, type: "social.new_follower", channels: ["in_app"],
      title: "New follower", body: "alice started following you.",
      i18n:  { key: "common:notify.newFollower", params: { name: "alice" } },
    });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId, type: "social.new_follower" } });
    expect(row.title).toBe("New follower");
    expect(row.meta).toMatchObject({ i18n: { key: "common:notify.newFollower", params: { name: "alice" } } });
  });

  it("leaves meta alone when no translation is given", async () => {
    await notificationService.dispatch({ userId, type: "plain.text", title: "Hi", body: "There", channels: ["in_app"] });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId, type: "plain.text" } });
    expect(row.meta).toEqual({});
  });
});
