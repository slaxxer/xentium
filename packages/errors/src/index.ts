/**
 * @xentium/errors — the error vocabulary shared by every Xentium-framework
 * application (ADR-0006).
 *
 * XEC codes themselves stay in `@xentium/contracts`: the browser needs them to
 * localize messages, and this package is server-side. They are re-exported here
 * so error-handling code has a single import.
 */
export { XentiumError } from "./XentiumError.js";
export { createErrorMiddleware } from "./errorMiddleware.js";
export type {
  ErrorLogEntry,
  ErrorLogger,
  ErrorMiddlewareOptions,
  ErrorSeverity,
} from "./errorMiddleware.js";
export { XEC, type XecCode } from "@xentium/contracts";
