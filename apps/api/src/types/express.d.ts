// Ambient augmentation of the global Express namespace — request context
// attached by shared middleware, so handlers can read it without casts.
declare namespace Express {
  interface Request {
    /** Set by requireAuth (always) / optionalAuth (when a valid Bearer token is present). */
    userId?: string;
    /** Set alongside userId; identifies the access token's session. */
    sessionId?: string;
    /** The exact JSON body bytes as received (set by the JSON parser), for signature checks. */
    rawBody?: Buffer;
  }

  namespace Multer {
    interface File {
      /** Trusted extension derived from magic bytes by uploadSingle's MIME check. */
      detectedExt?: string;
    }
  }
}
