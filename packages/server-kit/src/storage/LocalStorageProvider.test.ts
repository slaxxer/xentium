/**
 * The two guards that make filesystem storage safe to hand user-supplied names.
 *
 * Both are security boundaries, and both fail open if broken: a widened
 * allowlist writes wherever a caller asks, and a broken traversal check writes
 * outside the upload root entirely. Neither shows up as a test failure anywhere
 * else, so they are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalStorageProvider } from "./LocalStorageProvider.js";

let base: string;
let storage: LocalStorageProvider;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "nodevo-storage-"));
  storage = new LocalStorageProvider({ baseDir: base, allowedSubdirs: ["avatars", "themes"] });
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("LocalStorageProvider", () => {
  it("round-trips a file and reports a relative path", async () => {
    const rel = await storage.save("avatars", "u1.png", Buffer.from("hello"));
    expect(rel).toBe("avatars/u1.png");
    await expect(storage.exists(rel)).resolves.toBe(true);
    await expect(fs.readFile(path.join(base, "avatars", "u1.png"), "utf8")).resolves.toBe("hello");
  });

  it("allows a nested path under an allowed root", async () => {
    // `themes/<id>` is how .nvtheme assets land.
    const rel = await storage.save(path.join("themes", "aperture"), "hero.jpg", Buffer.from("x"));
    expect(rel).toBe("themes/aperture/hero.jpg");
  });

  it("refuses a subdirectory that is not on the allowlist", async () => {
    await expect(storage.save("secrets", "id_rsa", Buffer.from("x"))).rejects.toMatchObject({
      code: "NEC-API-4003",
    });
  });

  it("refuses a prefix that merely looks allowed", async () => {
    // "avatars-evil" starts with "avatars" as a STRING but is a different
    // directory — the check is on path segments, not string prefixes.
    await expect(storage.save("avatars-evil", "x.png", Buffer.from("x"))).rejects.toMatchObject({
      code: "NEC-API-4003",
    });
  });

  it("blocks traversal out of the base", async () => {
    await expect(
      storage.save(path.join("avatars", "..", ".."), "escaped.txt", Buffer.from("x")),
    ).rejects.toMatchObject({ code: "NEC-API-4003" });

    await expect(
      storage.save("avatars", path.join("..", "..", "escaped.txt"), Buffer.from("x")),
    ).rejects.toBeTruthy();
  });

  it("deletes idempotently", async () => {
    const rel = await storage.save("avatars", "gone.png", Buffer.from("x"));
    await storage.delete(rel);
    await expect(storage.exists(rel)).resolves.toBe(false);
    await expect(storage.delete(rel)).resolves.toBeUndefined(); // second delete is a no-op
  });

  it("builds a public URL with forward slashes", () => {
    expect(storage.publicUrl("themes/aperture/hero.jpg")).toBe("/uploads/themes/aperture/hero.jpg");
  });

  it("honours a custom public prefix", () => {
    const s = new LocalStorageProvider({ baseDir: base, allowedSubdirs: ["avatars"], publicPrefix: "/files" });
    expect(s.publicUrl("avatars/u1.png")).toBe("/files/avatars/u1.png");
  });
});
