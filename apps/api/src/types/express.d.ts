// Ambient augmentation of the global Express namespace — request context
// attached by shared middleware, so handlers can read it without casts.
declare namespace Express {
  interface Request {
    /** Set by requireAuth (always) / optionalAuth (when a valid Bearer token is present). */
    userId?: string;
    /** Set alongside userId; identifies the access token's session. */
    sessionId?: string;
  }

  namespace Multer {
    interface File {
      /** Trusted extension derived from magic bytes by uploadSingle's MIME check. */
      detectedExt?: string;
    }
  }
}
