import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cleanImage, imagePipelineWorks, imageVariants } from "./images.js";

/** A 40×20 JPEG, as a phone would write it: sideways orientation, camera data and GPS. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: "#c33" } })
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "P1", Copyright: "me" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 12/1", GPSLongitudeRef: "E", GPSLongitude: "13/1 24/1 36/1" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg().toBuffer();
}

describe("image cleaning", () => {
  it("removes camera data and GPS, and turns the photo upright", async () => {
    const before = await sharp(await phonePhoto()).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const out = await cleanImage(await phonePhoto(), "me.jpg");
    const after = await sharp(out).metadata();
    expect(after.format).toBe("jpeg");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Orientation 6 = rotate 90°: the stored pixels are now 20 wide, 40 tall.
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(out.includes(Buffer.from("PhoneCo"))).toBe(false);
  });

  it("leaves GIF and SVG as they are, and refuses what is not an image", async () => {
    const gif = Buffer.from("GIF89a-not-really");
    expect(await cleanImage(gif, "x.gif")).toBe(gif);
    const svg = Buffer.from("<svg/>");
    expect(await cleanImage(svg, "x.svg")).toBe(svg);
    await expect(cleanImage(Buffer.from("plain text"), "x.png")).rejects.toMatchObject({ httpStatus: 422 });
  });

  it("makes three sizes, never upscaled, without metadata", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#39f" } }).withExif({ IFD0: { Make: "Cam" } }).jpeg().toBuffer();
    const { width, height, variants } = await imageVariants(big, "jpg");
    expect([width, height]).toEqual([3000, 1500]);
    const by = Object.fromEntries(variants.map((v) => [v.name, v]));
    expect([by.thumb!.width, by.thumb!.height, by.thumb!.ext]).toEqual([320, 160, "webp"]);
    expect([by.medium!.width, by.medium!.height]).toEqual([1280, 640]);
    expect(by.full!.width).toBe(2560);
    for (const v of variants) expect((await sharp(v.buffer).metadata()).exif).toBeUndefined();

    const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: "#39f" } }).png().toBuffer();
    const s = await imageVariants(small, "png");
    expect(s.variants.every((v) => v.width === 100)).toBe(true);
  });

  it("knows the pipeline works here", async () => {
    expect(await imagePipelineWorks()).toBe(true);
  });
});
