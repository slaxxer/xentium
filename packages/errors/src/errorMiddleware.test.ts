/**
 * The error response shape is a public contract.
 *
 * Every Xentium client — the ACP, the frontend, a plugin's own UI — branches on
 * `error.code` and localizes the message itself, which is the whole reason the
 * API stays locale-agnostic. So the shape is pinned here rather than left to be
 * discovered by whatever breaks first.
 *
 * The extraction to a package (ADR-0006) adds two things worth pinning too:
 * `persist` is optional, and a throwing `persist` must not be able to replace
 * the error being reported.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NEC } from "@nodevo/contracts";
import { XentiumError } from "./XentiumError.js";
import { createErrorMiddleware, type ErrorLogEntry } from "./errorMiddleware.js";

function invoke(
  err: unknown,
  opts: Partial<Parameters<typeof createErrorMiddleware>[0]> = {},
) {
  const logger = { error: vi.fn(), warn: vi.fn() };
  const entries: ErrorLogEntry[] = [];
  const mw = createErrorMiddleware({
    isProd: false,
    logger,
    persist: (e) => entries.push(e),
    ...opts,
  });

  let status = 0;
  let body: any;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  };
  const req = { url: "/api/things", method: "POST", id: 42, userId: "u1", log: { error: vi.fn(), warn: vi.fn() } };

  mw(err, req as never, res as never, vi.fn());
  return { status, body, entries, logger };
}

describe("createErrorMiddleware", () => {
  it("renders a XentiumError with its own status and code", () => {
    const { status, body } = invoke(
      new XentiumError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "No such thing" }),
    );
    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: "NEC-API-4004", message: "No such thing", details: undefined, severity: "warn" },
    });
  });

  it("grades severity off the status", () => {
    expect(invoke(new XentiumError({ code: NEC.API_INTERNAL, httpStatus: 500, message: "x" })).body.error.severity)
      .toBe("error");
    expect(invoke(new XentiumError({ code: NEC.API_FORBIDDEN, httpStatus: 403, message: "x" })).body.error.severity)
      .toBe("warn");
  });

  it("honours persist:false so high-frequency rejections do not fill the log", () => {
    const { entries } = invoke(
      new XentiumError({ code: NEC.AUTH_TOKEN_INVALID, httpStatus: 401, message: "expired", persist: false }),
    );
    expect(entries).toHaveLength(0);
  });

  it("answers a ZodError with 422 and the validation code", () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    const { status, body, entries } = invoke((parsed as { error: unknown }).error);
    expect(status).toBe(422);
    expect(body.error.code).toBe(NEC.API_VALIDATION);
    expect(entries[0]!.severity).toBe("warn");
  });

  it("hides an unknown error's message in production, but not in development", () => {
    const boom = new Error("connection string is postgres://user:hunter2@db");
    expect(invoke(boom, { isProd: true }).body.error.message).toBe("Internal server error");
    expect(invoke(boom, { isProd: false }).body.error.message).toContain("hunter2");
  });

  it("records the request id as a string", () => {
    // req.id arrives as a NUMBER from the request-id middleware while the log
    // column is a string — the coercion that kept the Error Log empty when it
    // was missing.
    const { entries } = invoke(new XentiumError({ code: NEC.API_INTERNAL, httpStatus: 500, message: "x" }));
    expect(entries[0]!.requestId).toBe("42");
  });

  it("works with no persist function at all", () => {
    // An application with no error-log table is a legitimate consumer.
    const { status, body } = invoke(
      new XentiumError({ code: NEC.API_CONFLICT, httpStatus: 409, message: "dup" }),
      { persist: undefined },
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe("NEC-API-4009");
  });

  it("does not let a failing persist replace the error being reported", () => {
    const { status, body, logger } = invoke(
      new XentiumError({ code: NEC.API_NOT_FOUND, httpStatus: 404, message: "No such thing" }),
      { persist: () => { throw new Error("log table is gone"); } },
    );
    expect(status).toBe(404);
    expect(body.error.message).toBe("No such thing");
    // …but the failure is surfaced rather than swallowed.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NEC-API-4004" }),
      "error_log_persist_failed",
    );
  });
});
