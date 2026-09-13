/**
 * Refuse an image that is bigger than the surface it is destined for.
 *
 * ⚠ DIMENSIONS, not bytes. `UPLOAD_LIMITS` already bounds the file, and a badge
 * slot 32 pixels across still has to refuse a 2000x2000 PNG that happens to
 * compress to 40 KB — the cost being paid is the pixels shipped to every visitor
 * who sees that badge on a card, which a byte ceiling does not describe.
 *
 * Runs AFTER `uploadSingle`, which has already read the real type from the file's
 * magic bytes; this reads the header of that same buffer.
 *
 * A MAXIMUM, not an exact match: a 16x16 favicon-sized badge is a fine badge, and
 * demanding exactly 32x32 would reject it for being modest.
 */
import type { RequestHandler } from "express";
import { imageSize } from "image-size";
import { XentiumError } from "../errors/XentiumError.js";
import { XEC } from "@xentium/contracts";

export function requireMaxDimensions(maxWidth: number, maxHeight: number): RequestHandler {
  return (req, _res, next) => {
    const file = req.file;
    if (!file) return next();

    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = imageSize(file.buffer));
    } catch {
      // A buffer whose type was detected but whose header will not parse. Refused
      // rather than waved through: the whole point of this gate is that nothing
      // unbounded reaches the page.
      return next(new XentiumError({
        code:       XEC.STORE_MIME_MISMATCH,
        httpStatus: 415,
        message:    "Could not read the image's dimensions",
      }));
    }

    if (!width || !height) {
      return next(new XentiumError({
        code:       XEC.STORE_MIME_MISMATCH,
        httpStatus: 415,
        message:    "Could not read the image's dimensions",
      }));
    }

    if (width > maxWidth || height > maxHeight) {
      return next(new XentiumError({
        code:       XEC.STORE_IMAGE_TOO_LARGE,
        httpStatus: 422,
        // The numbers travel in `details` because the API is locale-agnostic (§60) —
        // the frontend words the sentence the admin actually reads.
        message:    `Image is ${width}x${height}; the maximum is ${maxWidth}x${maxHeight}`,
        details:    { width, height, maxWidth, maxHeight },
      }));
    }

    next();
  };
}
