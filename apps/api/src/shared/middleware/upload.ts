import type { RequestHandler } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { NEC } from "@nodevo/contracts";
import { NodevoError } from "../errors/NodevoError.js";
import { UPLOAD_LIMITS, type UploadLimitKey } from "../../config/upload-limits.js";

// Upload middleware factory.
//
// Combines multer (memory storage + size guard) with magic-byte MIME validation
// via `file-type`. The Content-Type header is user-controlled and never trusted
// (§17b). Files arrive in memory; the route handler hands the Buffer to the
// StorageProvider after the middleware accepts it.
//
// Usage:
//   router.post('/upload', uploadSingle('FEATURED_IMAGE', 'file'), handler)

export function uploadSingle(limitKey: UploadLimitKey, fieldName: string): RequestHandler[] {
  const limit = UPLOAD_LIMITS[limitKey];
  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limit.maxBytes, files: 1 },
  });

  const multerMiddleware: RequestHandler = (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return next(
          new NodevoError({
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
    if (!req.file) {
      return next(
        new NodevoError({
          code: NEC.API_VALIDATION,
          httpStatus: 400,
          message: `Missing file field "${fieldName}"`,
        }),
      );
    }

    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected) {
      return next(
        new NodevoError({
          code: NEC.STORE_MIME_MISMATCH,
          httpStatus: 415,
          message: "Could not detect file type from contents",
        }),
      );
    }

    if (!(limit.allowedMimeTypes as readonly string[]).includes(detected.mime)) {
      return next(
        new NodevoError({
          code: NEC.STORE_TYPE_NOT_PERMITTED,
          httpStatus: 415,
          message: `File type ${detected.mime} not permitted`,
          details: { detected: detected.mime, allowed: limit.allowedMimeTypes },
        }),
      );
    }

    // Replace the user-sent mimetype with the trusted, magic-byte-derived one
    req.file.mimetype = detected.mime;
    // Stash the detected extension so the route handler can name the file
    (req.file as { detectedExt?: string }).detectedExt = detected.ext;
    next();
  };

  return [multerMiddleware, mimeCheck];
}
