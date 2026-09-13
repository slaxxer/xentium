/**
 * The reader's theme choice, and the one rule that keeps it coherent.
 *
 * @vitest-environment jsdom
 *
 * ⚠ The stylesheet and the layout documents must be asked with the SAME answer. One
 * theme's colours over another's arrangement is the half-applied look this feature
 * exists to avoid, and the two fetches live in different files — so the parameter
 * comes from one place and is tested here.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { setViewerTheme, viewerThemeId, viewerThemeParam } from "./viewerTheme";

const clear = () => { document.cookie = "xt_theme=; path=/; max-age=0"; };

beforeEach(clear);

describe("choosing a theme", () => {
  it("has no choice by default — the site's own theme", () => {
    expect(viewerThemeId()).toBeNull();
    expect(viewerThemeParam()).toBe("");
  });

  it("remembers a choice and offers it as a query parameter", () => {
    setViewerTheme("meadow");
    expect(viewerThemeId()).toBe("meadow");
    expect(viewerThemeParam()).toBe("theme=meadow");
  });

  it("clears back to the site's theme", () => {
    setViewerTheme("meadow");
    setViewerTheme(null);
    expect(viewerThemeId()).toBeNull();
    expect(viewerThemeParam()).toBe("");
  });

  it("refuses a value that is not a theme id", () => {
    // The cookie is the reader's to edit. Anything that is not slug-shaped is not
    // something we installed, so it is not a choice — the API would fall back
    // anyway, but a bad value must never reach a URL.
    document.cookie = "xt_theme=" + encodeURIComponent("../../etc/passwd") + "; path=/";
    expect(viewerThemeId()).toBeNull();
    expect(viewerThemeParam()).toBe("");
  });

  it("survives another cookie sitting beside it", () => {
    document.cookie = "other=1; path=/";
    setViewerTheme("clanforge");
    expect(viewerThemeId()).toBe("clanforge");
    document.cookie = "other=; path=/; max-age=0";
  });

  it("encodes the value it puts in a URL", () => {
    // Ids are slugs, so this should never bite — but the parameter is concatenated
    // into a request URL, and "should never" is not a reason to skip encoding.
    setViewerTheme("a.b-c_d");
    expect(viewerThemeParam()).toBe("theme=a.b-c_d");
  });
});
