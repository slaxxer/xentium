/** Custom emojis: create, unique shortcodes (retired ones keep theirs), retire hides; the default set. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { emojiService } from "./emojis.service.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { DEFAULT_EMOJIS, ensureDefaultEmojis } from "./defaultEmojis.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2213fbc0000000049454e44ae426082", "hex");
const P = "emoji_probe";

// The test writes real files (the storage provider is not mocked), so it removes them too.
async function clean() {
  const rows = await prisma.emoji.findMany({ where: { shortcode: { startsWith: P } }, select: { image: true } });
  await Promise.all(rows.map((r) => storage.delete(r.image).catch(() => {})));
  await prisma.emoji.deleteMany({ where: { shortcode: { startsWith: P } } });
}
beforeEach(async () => { assertDisposableDatabase(); await clean(); });
afterEach(clean);

describe("custom emojis", () => {
  it("creates, lists in category order and retires out of the picker", async () => {
    const a = await emojiService.create({ shortcode: `${P}_a`, category: "Faces" }, { buffer: PNG, ext: "png" }, "u");
    const b = await emojiService.create({ shortcode: `${P}_b`, category: "Faces" }, { buffer: PNG, ext: "png" }, "u");
    expect(a.url).toMatch(/^\/uploads\/emojis\/[\w-]+\.png$/);
    expect(b.position).toBe(a.position + 1);
    expect((await emojiService.listActive()).map((e) => e.shortcode)).toEqual(expect.arrayContaining([`${P}_a`, `${P}_b`]));
    await emojiService.retire(a.id);
    expect((await emojiService.listActive()).some((e) => e.id === a.id)).toBe(false);
    // The row and its file stay, so posts that used it still render.
    expect(await prisma.emoji.findUnique({ where: { id: a.id } })).not.toBeNull();
  });

  it("refuses a shortcode that is taken, even by a retired emoji", async () => {
    const a = await emojiService.create({ shortcode: `${P}_x` }, { buffer: PNG, ext: "png" }, "u");
    await expect(emojiService.create({ shortcode: `${P}_x` }, { buffer: PNG, ext: "png" }, "u")).rejects.toMatchObject({ httpStatus: 409 });
    await emojiService.retire(a.id);
    await expect(emojiService.create({ shortcode: `${P}_x` }, { buffer: PNG, ext: "png" }, "u")).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("renames and moves an emoji", async () => {
    const a = await emojiService.create({ shortcode: `${P}_m`, category: "A" }, { buffer: PNG, ext: "png" }, "u");
    const moved = await emojiService.update(a.id, { shortcode: `${P}_n`, category: "B", name: "Nice" });
    expect(moved).toMatchObject({ shortcode: `${P}_n`, category: "B", name: "Nice" });
  });
});

describe("order and categories", () => {
  const mk = (code: string, category: string) =>
    emojiService.create({ shortcode: `${P}_${code}`, category }, { buffer: PNG, ext: "png" }, "u");

  it("reorders a category, and a drop moves an emoji into another", async () => {
    const a = await mk("o1", "Probe A"); const b = await mk("o2", "Probe A"); const c = await mk("o3", "Probe B");
    await emojiService.reorder("Probe A", [b.id, c.id, a.id]);
    const rows = await prisma.emoji.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, orderBy: { position: "asc" } });
    expect(rows.map((r) => [r.shortcode, r.category, r.position])).toEqual([
      [`${P}_o2`, "Probe A", 0], [`${P}_o3`, "Probe A", 1], [`${P}_o1`, "Probe A", 2],
    ]);
  });

  it("refuses an order naming a retired or unknown emoji", async () => {
    const a = await mk("o4", "Probe A"); const b = await mk("o5", "Probe A");
    await emojiService.retire(b.id);
    await expect(emojiService.reorder("Probe A", [a.id, b.id])).rejects.toMatchObject({ httpStatus: 409 });
    await expect(emojiService.reorder("Probe A", [a.id, "nope"])).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("renames a category, merging into an existing one after its emojis", async () => {
    const a = await mk("r1", "Probe Old"); const b = await mk("r2", "Probe New");
    expect(await emojiService.renameCategory("Probe Old", "Probe New")).toEqual({ moved: 1 });
    const moved = await prisma.emoji.findUniqueOrThrow({ where: { id: a.id } });
    const kept = await prisma.emoji.findUniqueOrThrow({ where: { id: b.id } });
    expect(moved.category).toBe("Probe New");
    expect(moved.position).toBeGreaterThan(kept.position);
  });
});

describe("default emojis", () => {
  const codes = DEFAULT_EMOJIS.map((e) => e.shortcode);
  async function reset() {
    const rows = await prisma.emoji.findMany({ where: { shortcode: { in: codes } }, select: { image: true } });
    await Promise.all(rows.map((r) => storage.delete(r.image).catch(() => {})));
    await prisma.emoji.deleteMany({ where: { shortcode: { in: codes } } });
    await prisma.setting.deleteMany({ where: { key: "emojis.defaultsSeeded" } });
    bustSettingsCache("emojis.defaultsSeeded");
  }
  beforeEach(reset);
  afterEach(reset);

  it("seeds the smileys once, and a retired one stays retired", async () => {
    await ensureDefaultEmojis();
    const active = await emojiService.listActive();
    expect(codes.every((c) => active.some((e) => e.shortcode === c))).toBe(true);
    const happy = active.find((e) => e.shortcode === "happy")!;
    expect(happy).toMatchObject({ category: "Smileys" });
    // A unique name: the tests share the upload directory with the dev instance.
    expect(happy.url).toMatch(/^\/uploads\/emojis\/happy-[\w-]+\.png$/);
    await emojiService.retire(happy.id);
    await ensureDefaultEmojis();
    expect((await emojiService.listActive()).some((e) => e.shortcode === "happy")).toBe(false);
    expect(await prisma.emoji.count({ where: { shortcode: "happy" } })).toBe(1);
  });

  it("leaves a shortcode the admin already uses alone", async () => {
    const own = await emojiService.create({ shortcode: "sad", category: "Mine" }, { buffer: PNG, ext: "png" }, "u");
    await ensureDefaultEmojis();
    expect(await prisma.emoji.findUnique({ where: { shortcode: "sad" } })).toMatchObject({ id: own.id, category: "Mine" });
  });
});
