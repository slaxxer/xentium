/**
 * Files for plugins: checked by their bytes, stored under a name core picks,
 * images cleaned of camera data and sized; public ones served by /uploads,
 * private ones never.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import type { Express } from "express";

const { prisma } = await import("../../infrastructure/db.js");
const { env } = await import("../../config/env.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { __resetInstalledCache } = await import("../../shared/middleware/installGuard.js");
const { createApp } = await import("../../app/app.js");
const { dropPluginFiles, filesFor, liveAddonFile } = await import("./files.js");

const P = "ftest";
const files = filesFor(P);
let app: Express;
let installRowCreated = false;

const photo = () => sharp({ create: { width: 1600, height: 900, channels: 3, background: "#5a5" } })
  .withExif({ IFD0: { Make: "PhoneCo" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 12/1" } })
  .jpeg().toBuffer();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

beforeAll(async () => {
  assertDisposableDatabase();
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({ where: { singleton: true }, update: { completedAt: new Date() }, create: { singleton: true, completedAt: new Date() } as never });
  }
  __resetInstalledCache();
  app = createApp();
});
afterAll(async () => {
  await dropPluginFiles(P);
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

describe("saving", () => {
  it("stores a photo in three sizes, without its camera data or GPS", async () => {
    const f = await files.save({ buffer: await photo(), originalname: "IMG_0001.jpg" }, { visibility: "public", accept: ["image"], kind: "gallery.photo", itemId: "p1" });
    expect(f).toMatchObject({ ext: "jpg", width: 1600, height: 900, originalName: "IMG_0001.jpg", kind: "gallery.photo", itemId: "p1" });
    expect(f.variants!.thumb).toMatchObject({ width: 320, height: 180, ext: "webp" });
    expect(f.url).toMatch(new RegExp(`^/uploads/addons/${P}/public/${f.ref}/full\\.`));
    const dir = path.join(env.UPLOAD_DIR, "addons", P, "public", f.ref);
    for (const name of await fs.readdir(dir)) {
      const bytes = await fs.readFile(path.join(dir, name));
      expect((await sharp(bytes).metadata()).exif).toBeUndefined();
      expect(bytes.includes(Buffer.from("PhoneCo"))).toBe(false);
    }
  });

  it("checks the type by the bytes, not the name, and the size", async () => {
    await expect(files.save({ buffer: PDF, originalname: "cute.png" }, { visibility: "public", accept: ["image"] })).rejects.toMatchObject({ httpStatus: 422 });
    await expect(files.save({ buffer: Buffer.from("just text"), originalname: "a.pdf" }, { visibility: "private", accept: ["pdf"] })).rejects.toMatchObject({ httpStatus: 422 });
    await expect(files.save(await photo(), { visibility: "public", accept: ["image"], maxBytes: 100 })).rejects.toMatchObject({ httpStatus: 413 });
    expect(() => files.save(PDF, { visibility: "public", accept: ["html"] })).rejects.toThrow(/not a file kind/);
  });
});

describe("serving", () => {
  it("serves a public file at its URL, and never a private one", async () => {
    const pub = await files.save(await photo(), { visibility: "public", accept: ["image"] });
    const res = await request(app).get(pub.variants!.thumb.url!);
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const priv = await files.save({ buffer: PDF, originalname: "invoice.pdf" }, { visibility: "private", accept: ["pdf"] });
    expect(priv.url).toBeNull();
    expect((await request(app).get(`/uploads/addons/${P}/private/${priv.ref}/file.pdf`)).status).toBe(404);

    // Through the plugin's own route, after its check: a download, with the member's name.
    const route = express();
    route.get("/f/:ref", async (req, res) => { await files.send(res, req.params.ref); });
    const got = await request(route).get(`/f/${priv.ref}`);
    expect(got.status).toBe(200);
    expect(got.headers["content-disposition"]).toMatch(/attachment; filename="?invoice\.pdf"?/);
    expect(got.headers["cache-control"]).toMatch(/no-store/);
  });

  it("finds only its own files", async () => {
    const other = filesFor("someone-else");
    const mine = await files.save(PDF, { visibility: "private", accept: ["pdf"] });
    expect(await other.get(mine.ref)).toBeNull();
    expect(await other.remove(mine.ref)).toBe(false);
    expect(await files.get(mine.ref)).not.toBeNull();
  });
});

describe("removing", () => {
  it("removes a file's row and bytes, one by one or per item", async () => {
    const a = await files.save(PDF, { visibility: "private", accept: ["pdf"], kind: "doc", itemId: "d1" });
    await files.save(PDF, { visibility: "private", accept: ["pdf"], kind: "doc", itemId: "d1" });
    expect(await files.remove(a.ref)).toBe(true);
    await expect(fs.stat(path.join(env.UPLOAD_DIR, "addons", P, "private", a.ref))).rejects.toThrow();
    expect(await files.removeFor({ kind: "doc", itemId: "d1" })).toBe(1);
    expect(await files.list({ kind: "doc" })).toEqual([]);
  });

  it("tells the purge which add-on files are still owned", () => {
    const ids = new Set(["11111111-1111-1111-1111-111111111111"]);
    expect(liveAddonFile("addons/x/public/11111111-1111-1111-1111-111111111111/thumb.webp", ids)).toBe(true);
    expect(liveAddonFile("addons/x/public/22222222-2222-2222-2222-222222222222/thumb.webp", ids)).toBe(false);
  });
});
