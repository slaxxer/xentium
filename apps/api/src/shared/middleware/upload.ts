/**
 * The CMS's binding of the framework upload middleware (`@nodevo/server-kit`).
 *
 * The package takes a resolved limit; `UPLOAD_LIMITS` (§17b) is this
 * application's table, so the key lookup stays here and every call site keeps
 * its existing `uploadSingle('FEATURED_IMAGE', 'file')` shape.
 */
import type { RequestHandler } from "express";
import { uploadSingle as uploadSingleWithLimit } from "@nodevo/server-kit";
import { UPLOAD_LIMITS, type UploadLimitKey } from "../../config/upload-limits.js";

export function uploadSingle(limitKey: UploadLimitKey, fieldName: string): RequestHandler[] {
  return uploadSingleWithLimit(UPLOAD_LIMITS[limitKey], fieldName);
}
