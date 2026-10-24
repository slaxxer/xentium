import sharp, { type Metadata } from "sharp";
import { XEC } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";

/**
 * Every raster image that reaches storage goes through here (ADR-0011).
 *
 * ⚠ Why: a photo from a phone carries EXIF — the camera, the time, and the GPS
 * position it was taken at, which for a member's avatar is usually their home.
 * Core used to store such files byte for byte. Now each one is turned upright by
 * its EXIF orientation and re-encoded in its own format WITHOUT EXIF, XMP, IPTC or
 * GPS. The colour profile is kept, so colours do not shift.
 *
 * GIF, SVG and ICO are left alone: they carry no camera data, and re-encoding a GIF
 * would lose its animation. An image that cannot be decoded is refused rather than
 * stored as it came, since stored-as-it-came is exactly what this exists to stop.
 */

const CLEAN = /\.(jpe?g|png|webp|avif|tiff?)$/i;

/** Will `cleanImage` re-encode a file with this name? */
export function isCleanable(filename: string): boolean {
  return CLEAN.test(filename);
}

function unreadable(): XentiumError {
  return new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "The image could not be read" });
}

/** Upright, same format, no metadata but the colour profile. */
export async function cleanImage(buffer: Buffer, filename: string): Promise<Buffer> {
  if (!CLEAN.test(filename)) return buffer;
  let meta: Metadata;
  try {
    meta = await sharp(buffer, { failOn: "none" }).metadata();
  } catch {
    throw unreadable();
  }
  const animated = (meta.pages ?? 1) > 1;
  try {
    const img = sharp(buffer, { failOn: "none", animated }).rotate().keepIccProfile();
    switch (meta.format) {
      case "jpeg": return await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      case "png":  return await img.png({ compressionLevel: 9 }).toBuffer();
      case "webp": return await img.webp({ quality: 90 }).toBuffer();
      case "heif": return await img.avif({ quality: 70 }).toBuffer();
      case "tiff": return await img.tiff().toBuffer();
      default:     return await img.toBuffer();
    }
  } catch {
    throw unreadable();
  }
}

/** The sizes a plugin's image is offered in: the longest side, in pixels. */
export const VARIANTS = { thumb: 320, medium: 1280, full: 2560 } as const;
export type VariantName = keyof typeof VARIANTS;

export interface Variant { name: VariantName; buffer: Buffer; ext: string; width: number; height: number }

/**
 * A cleaned image in its three sizes (never upscaled). Thumb and medium are WebP;
 * full keeps the original's format unless WebP is smaller. An animated GIF keeps
 * its original bytes as `full` and is drawn from its first frame for the others.
 */
export async function imageVariants(buffer: Buffer, ext: string): Promise<{ width: number; height: number; variants: Variant[] }> {
  const isGif = ext === "gif";
  const source = isGif ? buffer : await cleanImage(buffer, `x.${ext}`);
  let meta: Metadata;
  try { meta = await sharp(source, { failOn: "none" }).metadata(); } catch { throw unreadable(); }
  const width = meta.width ?? 0, height = meta.height ?? 0;

  const sized = async (max: number) => {
    const out = await sharp(source, { failOn: "none", pages: 1 }).rotate()
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  };

  const thumb = await sized(VARIANTS.thumb);
  const medium = await sized(VARIANTS.medium);
  let full: Variant;
  if (isGif) {
    full = { name: "full", buffer, ext: "gif", width, height };
  } else {
    const resized = await sharp(source, { failOn: "none" })
      .resize({ width: VARIANTS.full, height: VARIANTS.full, fit: "inside", withoutEnlargement: true })
      .keepIccProfile().toBuffer({ resolveWithObject: true });
    const webp = await sized(VARIANTS.full);
    full = webp.buffer.length < resized.data.length
      ? { name: "full", ext: "webp", ...webp }
      : { name: "full", buffer: resized.data, ext, width: resized.info.width, height: resized.info.height };
  }
  return {
    width, height,
    variants: [{ name: "thumb", ext: "webp", ...thumb }, { name: "medium", ext: "webp", ...medium }, full],
  };
}

/** Does `sharp` load on this server? (The CLI's server check asks.) */
export async function imagePipelineWorks(): Promise<boolean> {
  try {
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } }).png().toBuffer();
    return true;
  } catch {
    return false;
  }
}
