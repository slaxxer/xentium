import type { RequestHandler } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { NEC } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";

/**
 * One upload ceiling. An application owns its own table of these — the package
 * takes the resolved limit, not a key into someone else's map.
 */
export interface UploadLimit {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

/**
 * Upload middleware factory: multer (memory storage + size guard) plus
 * magic-byte MIME validation via `file-type`.
 *
 * The `Content-Type` header is user-controlled and is never trusted. Files
 * arrive in memory; a route handler passes the Buffer to a StorageProvider once
 * this middleware has accepted it.
 *
 *     router.post("/upload", ...uploadSingle(LIMITS.AVATAR, "file"), handler)
 */
export function uploadSingle(limit: UploadLimit, fieldName: string): RequestHandler[] {
  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limit.maxBytes, files: 1 },
  });

  const multerMiddleware: RequestHandler = (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return next(
          new XentiumError({
            code: NEC.STORE_FILE_TOO_LARGE,
            httpStatus: 413,
            message: `File exceeds ${limit.maxBytes} bytes`,
          }),
        );
      }
      next(err);
    });
  };

  const mimeCheck: RequestHandler = async (req, _res, next) => {
    // `detectedExt` is stashed for the route handler to name the file with. It
    // is declared locally because each application augments Express itself.
    const file = req.file as (Express.Multer.File & { detectedExt?: string }) | undefined;

    if (!file) {
      return next(
        new XentiumError({
          code: NEC.API_VALIDATION,
          httpStatus: 400,
          message: `Missing file field "${fieldName}"`,
        }),
      );
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected) {
      return next(
        new XentiumError({
          code: NEC.STORE_MIME_MISMATCH,
          httpStatus: 415,
          message: "Could not detect file type from contents",
        }),
      );
    }

    if (!(limit.allowedMimeTypes as readonly string[]).includes(detected.mime)) {
      return next(
        new XentiumError({
          code: NEC.STORE_TYPE_NOT_PERMITTED,
          httpStatus: 415,
          message: `File type ${detected.mime} not permitted`,
          details: { detected: detected.mime, allowed: limit.allowedMimeTypes },
        }),
      );
    }

    // Replace the user-sent mimetype with the trusted, magic-byte-derived one.
    file.mimetype = detected.mime;
    file.detectedExt = detected.ext;
    next();
  };

  return [multerMiddleware, mimeCheck];
}
