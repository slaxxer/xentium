/**
 * The CMS's binding of the framework error middleware (`@xentium/errors`).
 *
 * The package owns the response shape and the branching; this file supplies the
 * three things it cannot know — whether this deployment is production, where a
 * log line goes, and where an error record is stored. `ncf_error_log` is a CMS
 * table, so persistence is wired here rather than in the package.
 */
import { createErrorMiddleware, type ErrorLogEntry } from "@xentium/errors";
import { isProd } from "../../config/env.js";
import { prisma } from "../../infrastructure/db.js";
import { logger } from "../../infrastructure/logging/logger.js";

export const errorMiddleware = createErrorMiddleware({
  isProd,
  logger,
  // Fire-and-forget — never block the response. A rejected write is surfaced by
  // the package's own catch, which reports it through `logger`.
  persist: (entry: ErrorLogEntry) => {
    prisma.errorLog.create({
      data: {
        code:      entry.code,
        message:   entry.message,
        severity:  entry.severity,
        context:   entry.context ? (entry.context as object) : undefined,
        requestId: entry.requestId ?? null,
        userId:    entry.userId ?? null,
      },
    }).catch((e) => {
      logger.error({ err: e, code: entry.code }, "error_log_persist_failed");
    });
  },
});
