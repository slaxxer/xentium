/**
 * Crash classification — what the error screen keys every decision off.
 *
 * @vitest-environment jsdom
 *
 * The load-bearing claims: a stale-bundle failure is recognised as such (it
 * gets the reload flow, not the "something crashed" flow), and an API error
 * that escapes a component keeps its NEC code so the admin link can point at
 * the right reference entry.
 */
import { describe, expect, it } from "vitest";
import { describeError, formatReport } from "./clientErrors";

describe("describeError", () => {
  it("classifies a Vite dynamic-import failure as a chunk error", () => {
    const r = describeError(new Error("Failed to fetch dynamically imported module: /assets/PagesPage-3f9c1a.js"));
    expect(r.kind).toBe("chunk");
  });

  it("classifies the webpack/Chrome wordings too", () => {
    expect(describeError(new Error("Loading chunk 42 failed.")).kind).toBe("chunk");
    expect(describeError(new Error("error loading dynamically imported module")).kind).toBe("chunk");
    expect(describeError(new TypeError("Importing a module script failed.")).kind).toBe("chunk");
  });

  it("classifies a plain render throw as a crash", () => {
    const r = describeError(new TypeError("Cannot read properties of undefined (reading 'title')"));
    expect(r.kind).toBe("crash");
    expect(r.status).toBeUndefined();
    expect(r.stack).toContain("TypeError");
  });

  it("keeps the status and NEC code the api client attached", () => {
    const err = Object.assign(new Error("Group not found"), {
      status: 404,
      detail: { error: { code: "NEC-PERM-1001", message: "Group not found" } },
    });
    const r = describeError(err);
    expect(r.kind).toBe("http");
    expect(r.status).toBe(404);
    expect(r.code).toBe("NEC-PERM-1001");
  });

  it("takes status/statusText from a router ErrorResponse", () => {
    const r = describeError("boom", { status: 500, statusText: "Internal Server Error" });
    expect(r.kind).toBe("http");
    expect(r.message).toBe("Internal Server Error — boom");
  });

  it("survives a non-Error throw", () => {
    expect(describeError("just a string").message).toBe("just a string");
    expect(describeError({ weird: true }).message).toBe('{"weird":true}');
    expect(describeError(undefined).message).toBe("Unknown error");
  });

  it("mints a distinct, quotable reference per incident", () => {
    const a = describeError(new Error("x"));
    const b = describeError(new Error("x"));
    expect(a.reference).toMatch(/^NV-[0-9A-Z]+-[A-Z2-9]{3}$/);
    expect(a.reference).not.toBe(b.reference);
  });
});

describe("formatReport", () => {
  it("puts everything a maintainer needs in the copied text", () => {
    const err = Object.assign(new Error("Group not found"), {
      status: 404,
      detail: { error: { code: "NEC-PERM-1001" } },
    });
    const report = { ...describeError(err), componentStack: "\n    at GroupsPage" };
    const text = formatReport(report);

    expect(text).toContain(report.reference);
    expect(text).toContain("Status:  404");
    expect(text).toContain("NEC-PERM-1001");
    expect(text).toContain("Group not found");
    expect(text).toContain("at GroupsPage");
  });
});
