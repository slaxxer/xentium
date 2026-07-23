import type { NecCode } from './nec.js';

export class NodevoError extends Error {
  readonly code: NecCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  /** Set false for expected high-frequency rejections (token expiry, guest
   *  refresh) so errorMiddleware skips the error_log write. Default true. */
  readonly persist: boolean;

  constructor(opts: { code: NecCode; httpStatus: number; message: string; details?: unknown; persist?: boolean }) {
    super(opts.message);
    this.name = 'NodevoError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.details = opts.details;
    this.persist = opts.persist ?? true;
  }

  static notFound(message = 'Not found') {
    return new NodevoError({ code: 'NEC-API-4004', httpStatus: 404, message });
  }

  static conflict(message = 'Conflict') {
    return new NodevoError({ code: 'NEC-API-4009', httpStatus: 409, message });
  }

  static forbidden(message = 'Forbidden') {
    return new NodevoError({ code: 'NEC-API-4003', httpStatus: 403, message });
  }
}
