import { describe, expect, it } from "vitest";
import {
  BETA_MAX_PUBLIC_ROUTES,
  isBetaPublicRoute,
  normalizeBetaPublicRoutes,
} from "@nodevo/contracts";

/**
 * The gate's public-route allowance. Pure functions, no database — but they are
 * the whole of what stops "let my landing page through" from becoming "let
 * everything through", so they are worth pinning down precisely.
 */
describe("normalizeBetaPublicRoutes", () => {
  it("keeps a plain path and canonicalises it", () => {
    const { routes, rejected } = normalizeBetaPublicRoutes(["/Launch/"]);
    expect(routes).toEqual(["/launch"]);
    expect(rejected).toEqual([]);
  });

  it("refuses the reserved paths that would defeat the gate", () => {
    for (const path of ["/", "/admin", "/admin/settings", "/acp", "/login", "/register", "/install"]) {
      const { routes, rejected } = normalizeBetaPublicRoutes([path]);
      expect(routes, `${path} must not be allowed`).toEqual([]);
      expect(rejected[0]?.reason).toBe("reserved");
    }
  });

  it("refuses anything that leaves the origin", () => {
    for (const path of ["https://evil.test/launch", "//evil.test/launch"]) {
      const { routes, rejected } = normalizeBetaPublicRoutes([path]);
      expect(routes).toEqual([]);
      expect(rejected[0]?.reason).toBe("off-origin");
    }
  });

  it("refuses relative paths, traversal and non-strings", () => {
    const { routes, rejected } = normalizeBetaPublicRoutes(["launch", "/a/../admin", 42, null]);
    expect(routes).toEqual([]);
    expect(rejected).toHaveLength(4);
  });

  it("drops query and hash rather than storing them", () => {
    expect(normalizeBetaPublicRoutes(["/launch?ref=x#top"]).routes).toEqual(["/launch"]);
  });

  it("deduplicates and caps the list", () => {
    expect(normalizeBetaPublicRoutes(["/launch", "/LAUNCH/"]).routes).toEqual(["/launch"]);
    const many = Array.from({ length: BETA_MAX_PUBLIC_ROUTES + 5 }, (_, i) => `/p${i}`);
    const { routes, rejected } = normalizeBetaPublicRoutes(many);
    expect(routes).toHaveLength(BETA_MAX_PUBLIC_ROUTES);
    expect(rejected.every((r) => r.reason === "too-many")).toBe(true);
  });

  it("treats a non-array as an empty allowance", () => {
    expect(normalizeBetaPublicRoutes("/launch").routes).toEqual([]);
    expect(normalizeBetaPublicRoutes(undefined).routes).toEqual([]);
  });
});

describe("isBetaPublicRoute", () => {
  const allowed = ["/launch"];

  it("matches the path itself and anything below it", () => {
    expect(isBetaPublicRoute("/launch", allowed)).toBe(true);
    expect(isBetaPublicRoute("/launch/thanks", allowed)).toBe(true);
    expect(isBetaPublicRoute("/Launch/", allowed)).toBe(true);
  });

  it("does not match a path that merely starts with the same letters", () => {
    // The reason the match is on a segment boundary and not `startsWith`.
    expect(isBetaPublicRoute("/launchpad", allowed)).toBe(false);
    expect(isBetaPublicRoute("/launch-secrets", allowed)).toBe(false);
  });

  it("never matches on an empty allowance", () => {
    expect(isBetaPublicRoute("/launch", [])).toBe(false);
    expect(isBetaPublicRoute("/", [])).toBe(false);
  });

  it("cannot be opened up by an empty-string entry", () => {
    expect(isBetaPublicRoute("/admin", [""])).toBe(false);
  });
});
