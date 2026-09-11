/**
 * What may become a `<script src>` on every page of the site.
 *
 * ⚠ The interesting cases here are all REFUSALS. A kit URL is the one setting an
 * admin can supply that ends up executing JavaScript for every visitor, so the
 * tests that matter are the ones proving the shapes that must never survive.
 */
import { describe, it, expect } from "vitest";
import { parseKitUrl } from "./iconKit.js";

describe("what counts as a kit", () => {
  it("takes a full kit URL", () => {
    expect(parseKitUrl("https://kit.fontawesome.com/a1b2c3d4e5.js"))
      .toBe("https://kit.fontawesome.com/a1b2c3d4e5.js");
  });

  /** An admin copying from FontAwesome's dashboard may have either in the clipboard. */
  it("takes a bare kit id and builds the URL", () => {
    expect(parseKitUrl("a1b2c3d4e5")).toBe("https://kit.fontawesome.com/a1b2c3d4e5.js");
  });

  it("trims what was pasted", () => {
    expect(parseKitUrl("  a1b2c3d4e5  ")).toBe("https://kit.fontawesome.com/a1b2c3d4e5.js");
  });

  /** ⚠ Rebuilt, not echoed — a query string is a place to hide things. */
  it("drops a query string and fragment", () => {
    expect(parseKitUrl("https://kit.fontawesome.com/a1b2c3d4e5.js?x=1#y"))
      .toBe("https://kit.fontawesome.com/a1b2c3d4e5.js");
  });

  it("treats empty and non-strings as unset", () => {
    for (const v of ["", "   ", null, undefined, 42, {}, []]) {
      expect(parseKitUrl(v)).toBeNull();
    }
  });
});

describe("what must never become a script source", () => {
  /**
   * ⚠ THE POINT OF THE ALLOWLIST. Any host but FontAwesome's own is arbitrary
   * JavaScript running for every visitor to the site.
   */
  it("refuses any other host", () => {
    for (const u of [
      "https://evil.example/a1b2c3d4e5.js",
      "https://kit.fontawesome.com.evil.example/a1b2c3d4e5.js",
      "https://evil.example/kit.fontawesome.com/a1b2c3d4e5.js",
      "https://fontawesome.com/a1b2c3d4e5.js",
    ]) {
      expect(parseKitUrl(u)).toBeNull();
    }
  });

  /**
   * ⚠ Protocol is checked BEFORE host. These parse perfectly well and have no
   * hostname at all, so a host check on its own would not be reached.
   */
  it("refuses javascript: and data: URLs", () => {
    expect(parseKitUrl("javascript:alert(1)")).toBeNull();
    expect(parseKitUrl("data:text/javascript,alert(1)")).toBeNull();
  });

  it("refuses plain http, even on the right host", () => {
    expect(parseKitUrl("http://kit.fontawesome.com/a1b2c3d4e5.js")).toBeNull();
  });

  /** Credentials in a URL are never anything but an attempt at something. */
  it("refuses embedded credentials and an explicit port", () => {
    expect(parseKitUrl("https://user:pw@kit.fontawesome.com/a1b2c3d4e5.js")).toBeNull();
    expect(parseKitUrl("https://kit.fontawesome.com:8443/a1b2c3d4e5.js")).toBeNull();
  });

  /** Only a kit lives at a kit path; anything else on the host is not one. */
  it("refuses a path that is not a kit script", () => {
    for (const u of [
      "https://kit.fontawesome.com/",
      "https://kit.fontawesome.com/a1b2c3d4e5.json",
      "https://kit.fontawesome.com/../../etc/passwd",
      "https://kit.fontawesome.com/a1b2c3d4e5.js/extra.js",
      "https://kit.fontawesome.com/UPPERCASE.js",
    ]) {
      expect(parseKitUrl(u)).toBeNull();
    }
  });
});
