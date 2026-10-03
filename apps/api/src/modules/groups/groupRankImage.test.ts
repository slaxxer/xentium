/**
 * A group's rank image: stored under the DETECTED type beside the icons, replaced
 * without leaving the old file, removable — and kept apart from the icon, so one
 * upload never overwrites or deletes the other.
 *
 * Storage is an in-memory stand-in; nothing is written to a real upload directory.
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

const KEY = "rank_probe";
let groupId: string;

beforeEach(async () => {
  assertDisposableDatabase();
  files.clear();
  await prisma.group.deleteMany({ where: { key: KEY } });
  groupId = (await prisma.group.create({ data: { name: "Rank probe", key: KEY, isSystem: false } })).id;
});

afterEach(async () => {
  await prisma.group.deleteMany({ where: { key: KEY } });
});

const row = async () => (await prisma.group.findUnique({ where: { id: groupId } }))!;

describe("group rank images", () => {
  it("names the file after the detected type and returns its public URL", async () => {
    const url = await groupsService.uploadRankImage(groupId, Buffer.from("gif"), "gif");
    expect((await row()).rankImage).toBe(`groups/rank-${groupId}.gif`);
    expect(url).toBe(`/uploads/groups/rank-${groupId}.gif`);
  });

  it("removes the previous file when the new one has another type", async () => {
    await groupsService.uploadRankImage(groupId, Buffer.from("png"), "png");
    await groupsService.uploadRankImage(groupId, Buffer.from("webp"), "webp");
    expect([...files.keys()]).toEqual([`groups/rank-${groupId}.webp`]);
  });

  it("never touches the group's icon", async () => {
    await groupsService.uploadIcon(groupId, Buffer.from("icon"), "png");
    await groupsService.uploadRankImage(groupId, Buffer.from("rank"), "png");
    await groupsService.removeRankImage(groupId);
    expect((await row()).icon).toBe(`groups/${groupId}.png`);
    expect([...files.keys()]).toEqual([`groups/${groupId}.png`]);
  });

  it("goes back to the badge, and deletes the file", async () => {
    await groupsService.uploadRankImage(groupId, Buffer.from("png"), "png");
    await groupsService.removeRankImage(groupId);
    expect((await row()).rankImage).toBeNull();
    expect(files.size).toBe(0);
  });
});
