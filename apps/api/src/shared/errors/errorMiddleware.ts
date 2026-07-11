import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { NodevoError } from './NodevoError.js';
import { NEC } from './nec.js';
import { isProd } from '../../config/env.js';
import { prisma } from '../../infrastructure/db.js';
import { logger } from '../../infrastructure/logging/logger.js';

function persistErrorLog(opts: {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  context?: unknown;
  requestId?: string;
  userId?: string;
}) {
  // Fire-and-forget — never block the response, but DO surface a failed write to
  // the logs. A silent `.catch(() => {})` here previously meant a broken error_log
  // write (e.g. a non-serializable `context`) vanished without a trace.
  prisma.errorLog.create({
    data: {
      code:      opts.code,
      message:   opts.message,
      severity:  opts.severity,
      context:   opts.context ? (opts.context as object) : undefined,
      requestId: opts.requestId ?? null,
      userId:    opts.userId ?? null,
    },
  }).catch((e) => {
    logger.error({ err: e, code: opts.code }, 'error_log_persist_failed');
  });
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  // req.id is set by the request-id middleware as a NUMBER; the error_log.requestId
  // column is String?. Coerce, or every insert fails Prisma validation (the bug that
  // kept the Error Log permanently empty).
  const rawId     = (req as any).id;
  const requestId = rawId != null ? String(rawId) : undefined;
  const userId    = req.userId ?? undefined;

  if (err instanceof NodevoError) {
    const severity = err.httpStatus >= 500 ? 'error' : err.httpStatus >= 400 ? 'warn' : 'info';

    if (err.httpStatus >= 500) {
      req.log?.error({ err }, 'request_failed');
    } else {
      req.log?.warn({ code: err.code, status: err.httpStatus, url: req.url }, 'request_rejected');
    }

    persistErrorLog({
      code:      err.code,
      message:   err.message,
      severity,
      context:   err.details ? { details: err.details, url: req.url, method: req.method } : { url: req.url, method: req.method },
      requestId,
      userId,
    });

    return res.status(err.httpStatus).json({
      error: { code: err.code, message: err.message, details: err.details, severity },
    });
  }

  if (err instanceof ZodError) {
    req.log?.warn({ url: req.url }, 'validation_failed');

    persistErrorLog({
      code:      NEC.API_VALIDATION,
      message:   'Validation failed',
      severity:  'warn',
      context:   { url: req.url, method: req.method, issues: err.flatten() },
      requestId,
      userId,
    });

    return res.status(422).json({
      error: { code: NEC.API_VALIDATION, message: 'Validation failed', details: err.format(), severity: 'warn' },
    });
  }

  req.log?.error({ err }, 'request_failed');

  persistErrorLog({
    code:      NEC.API_INTERNAL,
    message:   (err as Error)?.message ?? 'Internal server error',
    severity:  'critical',
    context:   { url: req.url, method: req.method, stack: (err as Error)?.stack?.split('\n').slice(0, 5) },
    requestId,
    userId,
  });

  return res.status(500).json({
    error: {
      code:     NEC.API_INTERNAL,
      message:  isProd ? 'Internal server error' : String((err as Error)?.message ?? err),
      severity: 'critical',
    },
  });
};
