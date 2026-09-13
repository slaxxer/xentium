/**
 * Per-rank limits on the images a member may put on their own profile.
 *
 * ⚠ THE ONE CHOKEPOINT. `maxProfileImageBytes` and `allowedProfileImageTypes` have
 * been in `ncf_group_progression` since Phase 7 (§38) and were enforced NOWHERE —
 * stored, validated on the way in, resolved by `getUserLimits`, and never once read
 * by an upload route. Both the avatar and the cover go through here now, so a rank's
 * limits mean the same thing wherever a member uploads.
 *
 * These NARROW the global `UPLOAD_LIMITS` ceiling; they never widen it. A rung
 * allowing 10 MB cannot get past a 2 MB route limit, because multer has already
 * refused the request before this runs.
 */
import { XentiumError } from "@xentium/errors";
import { NEC } from "@xentium/contracts";
import { progressionService } from "../progression/progression.service.js";

export interface ProfileImageCheck {
  /** The already-magic-byte-verified MIME type, from `uploadSingle`. */
  mimeType: string;
  bytes:    number;
  /** Covers carry an extra gate; avatars do not. */
  kind:     "avatar" | "cover";
}

/**
 * Throws when this member's rank does not permit the upload.
 *
 * ⚠ Silent on a site with no ladder: `getUserLimits` answers with nulls and an empty
 * type list for a member in no progression group, and every check below treats that
 * as "no restriction". Progression is opt-in, so its absence must not lock anyone out.
 */
export async function assertProfileImageAllowed(
  userId: string,
  file: ProfileImageCheck,
): Promise<void> {
  const limits = await progressionService.getUserLimits(userId);

  if (file.kind === "cover" && limits.canUploadCover === false) {
    throw new XentiumError({
      code:       NEC.API_FORBIDDEN,
      httpStatus: 403,
      message:    "Your rank cannot set a cover image yet",
      // The frontend words the sentence (§60); it needs to know WHICH rung unlocks it.
      details:    { reason: "rank", unlocksAt: limits.badgeLabel ?? null },
    });
  }

  if (limits.maxProfileImageBytes != null && file.bytes > limits.maxProfileImageBytes) {
    throw new XentiumError({
      code:       NEC.STORE_FILE_TOO_LARGE,
      httpStatus: 413,
      message:    `Image is ${file.bytes} bytes; your rank allows ${limits.maxProfileImageBytes}`,
      details:    { bytes: file.bytes, maxBytes: limits.maxProfileImageBytes, reason: "rank" },
    });
  }

  // ⚠ EMPTY means "no per-rank restriction", not "nothing allowed". A rung that has
  // simply never been configured must not refuse every image.
  const allowed = limits.allowedProfileImageTypes ?? [];
  if (allowed.length > 0 && !allowed.includes(file.mimeType)) {
    throw new XentiumError({
      code:       NEC.STORE_TYPE_NOT_PERMITTED,
      httpStatus: 415,
      message:    `Your rank cannot upload ${file.mimeType}`,
      details:    { detected: file.mimeType, allowed, reason: "rank" },
    });
  }
}
