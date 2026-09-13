/**
 * Manifest parsing and the compatibility window.
 *
 * The prerelease rule is the one worth pinning: base versions only, so a
 * `1.0.0-alpha.3` host accepts a plugin targeting `1.0`. Compare full semver
 * instead and every prerelease cut rejects the entire plugin ecosystem — which
 * is a total outage of extensibility that no other test would catch.
 *
 * `tablePrefix` matters too. It is what the migration runner enforces to keep a
 * plugin's schema namespaced and unable to collide with core's `ncf_` or another
 * plugin's tables, so a loosened pattern here is a schema-collision bug later.
 */
import { describe, expect, it } from "vitest";
import { validateManifest, assertCompatible, createManifestValidator } from "./manifest.js";
import { compareBaseVersions, baseVersion } from "./version.js";

const base = {
  id: "xentium-forum",
  name: "Forum",
  version: "1.1.0",
  vendor: "Xentium",
  minXentiumVersion: "1.0",
};

describe("validateManifest", () => {
  it("parses a minimal manifest and applies defaults", () => {
    const m = validateManifest(base, "1.0.0");
    expect(m).toMatchObject({ id: "xentium-forum", licenseRequired: false });
    expect(m.permissions).toEqual([]);
    expect(m.migrations).toEqual([]);
    expect(m.entrypoints).toEqual({});
  });

  it("refuses an id that is not kebab-case", () => {
    expect(() => validateManifest({ ...base, id: "Xentium_Forum" }, "1.0.0")).toThrow();
  });

  it("refuses a non-semver version", () => {
    expect(() => validateManifest({ ...base, version: "1.1" }, "1.0.0")).toThrow();
  });

  it("accepts a prerelease host against a base-version floor", () => {
    // The whole ecosystem depends on this: an alpha build must not reject
    // every plugin that targets the release line it is working toward.
    expect(() => validateManifest(base, "1.0.0-alpha.3")).not.toThrow();
  });

  it("refuses a plugin that needs a newer host", () => {
    expect(() => validateManifest({ ...base, minXentiumVersion: "2.0" }, "1.0.0")).toThrow(
      /requires Xentium 2\.0\+/,
    );
  });

  it("refuses a plugin whose ceiling is below the host", () => {
    expect(() =>
      validateManifest({ ...base, maxXentiumVersion: "1.0" }, "2.1.0"),
    ).toThrow(/supports Xentium up to 1\.0/);
  });

  it("reports incompatibility with the plugin NEC code", () => {
    expect(() => validateManifest({ ...base, minXentiumVersion: "9.0" }, "1.0.0")).toThrow(
      expect.objectContaining({ code: "NEC-PLUGIN-2030", httpStatus: 422 }),
    );
  });

  describe("tablePrefix", () => {
    it.each(["forum_", "sb_", "amod_", "a1_"])("accepts %s", (tablePrefix) => {
      expect(() => validateManifest({ ...base, tablePrefix }, "1.0.0")).not.toThrow();
    });

    it.each(["Forum_", "forum", "_forum", "1forum_", "forum-x_"])("refuses %s", (tablePrefix) => {
      expect(() => validateManifest({ ...base, tablePrefix }, "1.0.0")).toThrow();
    });
  });

  it("binds to one host version through the factory", () => {
    const validate = createManifestValidator("1.0.0");
    expect(() => validate({ ...base, minXentiumVersion: "2.0" })).toThrow();
    expect(validate(base).id).toBe("xentium-forum");
  });

  it("checks compatibility independently of parsing", () => {
    const m = validateManifest(base, "1.0.0");
    expect(() => assertCompatible(m, "0.9.0")).toThrow();
    expect(() => assertCompatible(m, "1.4.2")).not.toThrow();
  });
});

describe("compareBaseVersions", () => {
  it("ignores prerelease and build metadata", () => {
    expect(compareBaseVersions("1.0.0-alpha.1", "1.0.0")).toBe(0);
    expect(compareBaseVersions("1.0.0+build.7", "1.0.0")).toBe(0);
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareBaseVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareBaseVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareBaseVersions("1.2.3", "1.2.4")).toBeLessThan(0);
  });

  it("treats an unparseable version as 0.0.0 rather than throwing", () => {
    expect(baseVersion("not-a-version")).toEqual([0, 0, 0]);
  });
});
