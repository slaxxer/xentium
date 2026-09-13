import type { NecCode } from "@xentium/contracts";

/**
 * The one error type every Xentium application throws.
 *
 * A XentiumError carries what a client needs (an NEC code and an HTTP status)
 * without leaking what it must not see (a stack trace). Anything that escapes
 * as a plain `Error` is treated as a 500 by the middleware, which is the
 * intended fallback, not a shortcut to rely on.
 */
export class XentiumError extends Error {
  readonly code: NecCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  /** Set false for expected high-frequency rejections (token expiry, guest
   *  refresh) so the middleware skips the error-log write. Default true. */
  readonly persist: boolean;

  constructor(opts: {
    code: NecCode;
    httpStatus: number;
    message: string;
    details?: unknown;
    persist?: boolean;
  }) {
    super(opts.message);
    this.name = "XentiumError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.details = opts.details;
    this.persist = opts.persist ?? true;
  }

  static notFound(message = "Not found") {
    return new XentiumError({ code: "NEC-API-4004", httpStatus: 404, message });
  }

  static conflict(message = "Conflict") {
    return new XentiumError({ code: "NEC-API-4009", httpStatus: 409, message });
  }

  static forbidden(message = "Forbidden") {
    return new XentiumError({ code: "NEC-API-4003", httpStatus: 403, message });
  }
}
