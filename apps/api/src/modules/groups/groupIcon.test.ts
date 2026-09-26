/**
 * A group's icon: stored under the type the upload middleware DETECTED (never
 * the client's filename), replaced without leaving the old file behind, and
 * removable — the ACP had an upload and no way back to the default glyph.
 *
 * Storage is an in-memory stand-in: these tests must never write into a real
 * upload directory, and the rules under test are the service's, not the disk's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, Buffer>();
vi.mock("../../infrastructure/storage/LocalStorageProvider.js", () => ({
  storage: {
    save: async (subdir: string, name: string, data: Buffer) => { files.set(`${subdir}/${name}`, data); return `${subdir}/${name}`; },
    delete: async (rel: string) => { files.delete(rel); },
    exists: async (rel: string) => files.has(rel),
    publicUrl: (rel: string) => `/uploads/${rel}`,
  },
}));

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { groupsService } = await import("./groups.service.js");

const KEY = "icon_probe";
let groupId: string;

beforeEach(async () => {
  assertDisposableDatabase();
  files.clear();
  await prisma.group.deleteMany({ where: { key: KEY } });
  groupId = (await prisma.group.create({ data: { name: "Icon probe", key: KEY, isSystem: false } })).id;
});

afterEach(async () => {
  await prisma.group.deleteMany({ where: { key: KEY } });
});

const iconOf = async () => (await prisma.group.findUnique({ where: { id: groupId } }))!.icon;

describe("group icons", () => {
  it("names the file after the detected type", async () => {
    await groupsService.uploadIcon(groupId, Buffer.from("png"), "png");
    expect(await iconOf()).toBe(`groups/${groupId}.png`);
  });

  it("removes the previous file when the new one has another type", async () => {
    await groupsService.uploadIcon(groupId, Buffer.from("png"), "png");
    await groupsService.uploadIcon(groupId, Buffer.from("webp"), "webp");
    expect(await iconOf()).toBe(`groups/${groupId}.webp`);
    expect([...files.keys()]).toEqual([`groups/${groupId}.webp`]);
  });

  it("goes back to no icon, and deletes the file", async () => {
    await groupsService.uploadIcon(groupId, Buffer.from("png"), "png");
    await groupsService.removeIcon(groupId);
    expect(await iconOf()).toBeNull();
    expect(files.size).toBe(0);
  });

  it("is idempotent for a group with no icon", async () => {
    await expect(groupsService.removeIcon(groupId)).resolves.toBeUndefined();
    expect(await iconOf()).toBeNull();
  });
});
