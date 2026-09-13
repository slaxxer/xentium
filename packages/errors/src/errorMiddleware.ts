import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { NEC } from "@nodevo/contracts";
import { XentiumError } from "./XentiumError.js";

export type ErrorSeverity = "info" | "warn" | "error" | "critical";

/** One row an application may choose to persist. The package never decides
 *  where this goes — an application knows its own storage. */
export interface ErrorLogEntry {
  code: string;
  message: string;
  severity: ErrorSeverity;
  context?: unknown;
  requestId?: string;
  userId?: string;
}

/** The two levels this middleware uses. Pino satisfies it as-is. */
export interface ErrorLogger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

export interface ErrorMiddlewareOptions {
  /** Hides internal messages behind a generic 500 body. */
  isProd: boolean;
  /** Application logger, used when a persist call itself fails. */
  logger: ErrorLogger;
  /**
   * Persist a record of the error. Fire-and-forget: the middleware never awaits
   * it and never lets it delay a response. Omit it and nothing is persisted —
   * which is a legitimate choice for an application with no error-log table.
   */
  persist?: (entry: ErrorLogEntry) => void;
}

/**
 * Fields the middleware reads opportunistically. They are declared here rather
 * than imported because each application augments Express itself — this package
 * must not require any particular augmentation to exist.
 */
type AugmentedRequest = Request & {
  id?: unknown;
  userId?: string;
  log?: Partial<ErrorLogger>;
};

/**
 * The last handler in the chain. Turns anything thrown during a request into
 * the one response shape every Xentium API speaks:
 *
 *     { error: { code, message, details?, severity } }
 *
 * `code` is always an NEC string, so a client can branch on the code and
 * localize the message itself — which is why the API stays locale-agnostic.
 *
 * Three cases, in order: a XentiumError (deliberate, carries its own status), a
 * ZodError (input validation, always 422), and anything else (500, message
 * hidden in production).
 */
export function createErrorMiddleware(opts: ErrorMiddlewareOptions): ErrorRequestHandler {
  const { isProd, logger, persist } = opts;

  const record = (entry: ErrorLogEntry) => {
    if (!persist) return;
    try {
      persist(entry);
    } catch (e) {
      // A failing persist must never replace the error being reported, but it
      // must not vanish either: a silent catch here previously meant a broken
      // write (e.g. a non-serializable `context`) left no trace at all.
      logger.error({ err: e, code: entry.code }, "error_log_persist_failed");
    }
  };

  return (err, req, res, _next) => {
    const r = req as AugmentedRequest;

    // req.id is set by the request-id middleware as a NUMBER, while the
    // error-log column is a string. Coerce, or every insert fails validation —
    // the bug that kept the Error Log permanently empty.
    const requestId = r.id != null ? String(r.id) : undefined;
    const userId = r.userId ?? undefined;
    const where = { url: req.url, method: req.method };

    if (err instanceof XentiumError) {
      const severity: ErrorSeverity =
        err.httpStatus >= 500 ? "error" : err.httpStatus >= 400 ? "warn" : "info";

      if (err.httpStatus >= 500) {
        r.log?.error?.({ err }, "request_failed");
      } else {
        r.log?.warn?.({ code: err.code, status: err.httpStatus, url: req.url }, "request_rejected");
      }

      if (err.persist) {
        record({
          code: err.code,
          message: err.message,
          severity,
          context: err.details ? { details: err.details, ...where } : where,
          requestId,
          userId,
        });
      }

      return res.status(err.httpStatus).json({
        error: { code: err.code, message: err.message, details: err.details, severity },
      });
    }

    if (err instanceof ZodError) {
      r.log?.warn?.({ url: req.url }, "validation_failed");

      record({
        code: NEC.API_VALIDATION,
        message: "Validation failed",
        severity: "warn",
        context: { ...where, issues: err.flatten() },
        requestId,
        userId,
      });

      return res.status(422).json({
        error: {
          code: NEC.API_VALIDATION,
          message: "Validation failed",
          details: err.format(),
          severity: "warn",
        },
      });
    }

    r.log?.error?.({ err }, "request_failed");

    record({
      code: NEC.API_INTERNAL,
      message: (err as Error)?.message ?? "Internal server error",
      severity: "critical",
      context: { ...where, stack: (err as Error)?.stack?.split("\n").slice(0, 5) },
      requestId,
      userId,
    });

    return res.status(500).json({
      error: {
        code: NEC.API_INTERNAL,
        // Never leak an internal message to a client in production.
        message: isProd ? "Internal server error" : String((err as Error)?.message ?? err),
        severity: "critical",
      },
    });
  };
}
