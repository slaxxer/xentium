// §17b — central upload limits, used by multer (size) and the storage service
// (magic-byte MIME check via `file-type`). Per-group overrides for avatars come
// from group_progression (§38); this file is the global ceiling.

export interface UploadLimit {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

const KB = 1024;
const MB = 1024 * KB;

export const UPLOAD_LIMITS = {
  AVATAR: {
    maxBytes: 2 * MB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  FEATURED_IMAGE: {
    maxBytes: 5 * MB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  ARTICLE_IMAGE: {
    maxBytes: 5 * MB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  GROUP_ICON: {
    maxBytes: 512 * KB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  // A badge is 32x32 on the page (enforced as DIMENSIONS by `requireMaxDimensions`,
  // which a byte ceiling cannot express). The bytes are bounded far below the group
  // icon's anyway: at this size only an animated GIF has any reason to be large, and
  // a badge is drawn many times per page — beside every author in a thread.
  // A member's own profile cover. 2 MB is what the design tells them on the
  // dropzone, and the number a member reads must be the number the server enforces.
  // GIF is allowed HERE so that "animated covers" can be granted per rank through
  // `allowedProfileImageTypes` — a type the route refuses could never be unlocked.
  PROFILE_COVER: {
    maxBytes: 2 * MB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
  BADGE_ICON: {
    maxBytes: 128 * KB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  NAVBAR_LOGO: {
    maxBytes: 2 * MB,
    allowedMimeTypes: ["image/png", "image/svg+xml", "image/webp"],
  },
  SITE_ICON: {
    maxBytes: 512 * KB,
    allowedMimeTypes: ["image/png", "image/x-icon", "image/svg+xml"],
  },
  // Section backgrounds placed from the layout editor. Larger than a featured
  // image because this one is a full-bleed band behind a masthead, not a card
  // thumbnail — and still bounded, because it is served to every visitor on
  // every page when it sits in the chrome.
  LAYOUT_IMAGE: {
    maxBytes: 5 * MB,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"],
  },
  PLUGIN_PACKAGE: {
    maxBytes: 50 * MB,
    allowedMimeTypes: ["application/zip", "application/octet-stream"],
  },
  STYLE_PACK: {
    maxBytes: 10 * MB,
    allowedMimeTypes: ["application/zip", "application/octet-stream"],
  },
} as const satisfies Record<string, UploadLimit>;

export type UploadLimitKey = keyof typeof UPLOAD_LIMITS;
