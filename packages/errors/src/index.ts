/**
 * @nodevo/errors — the error vocabulary shared by every Nodevo-framework
 * application (ADR-0006).
 *
 * NEC codes themselves stay in `@nodevo/contracts`: the browser needs them to
 * localize messages, and this package is server-side. They are re-exported here
 * so error-handling code has a single import.
 */
export { NodevoError } from "./NodevoError.js";
export { createErrorMiddleware } from "./errorMiddleware.js";
export type {
  ErrorLogEntry,
  ErrorLogger,
  ErrorMiddlewareOptions,
  ErrorSeverity,
} from "./errorMiddleware.js";
export { NEC, type NecCode } from "@nodevo/contracts";
