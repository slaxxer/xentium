/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logoIconColours, syncFavicon } from "./siteFavicon";

function icons() {
  return [...document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")];
}

describe("site favicon", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" type="image/svg+xml" href="/brand/favicon.svg" />`;
  });
  afterEach(() => {
    document.documentElement.style.removeProperty("--logo-icon-from");
    document.documentElement.style.removeProperty("--logo-icon-to");
  });

  it("keeps the shipped files while the colours are the brand's", () => {
    syncFavicon(null);
    expect(icons().map((l) => l.getAttribute("href"))).toEqual(["/favicon.ico", "/brand/favicon.svg"]);
  });

  it("draws the mark in the site's Logo icon colours", () => {
    document.documentElement.style.setProperty("--logo-icon-from", "#000000");
    document.documentElement.style.setProperty("--logo-icon-to", "#111111");
    syncFavicon(null);
    for (const link of icons()) {
      const svg = decodeURIComponent(link.href.replace(/^data:image\/svg\+xml,/, ""));
      expect(svg).toContain('stop-color="#000000"');
      expect(svg).toContain('stop-color="#111111"');
      expect(link.hasAttribute("type")).toBe(false);
    }
  });

  it("restores the shipped files when the colours go back to the brand's", () => {
    document.documentElement.style.setProperty("--logo-icon-from", "#000000");
    syncFavicon(null);
    document.documentElement.style.removeProperty("--logo-icon-from");
    syncFavicon(null);
    expect(icons().map((l) => l.getAttribute("href"))).toEqual(["/favicon.ico", "/brand/favicon.svg"]);
    expect(icons()[1]!.type).toBe("image/svg+xml");
    expect(icons()[0]!.getAttribute("sizes")).toBe("any");
  });

  it("an uploaded icon wins over the colours", () => {
    document.documentElement.style.setProperty("--logo-icon-from", "#000000");
    syncFavicon("/uploads/icon.png");
    expect(icons().every((l) => l.getAttribute("href") === "/uploads/icon.png")).toBe(true);
  });

  it("refuses a token that is not a plain colour", () => {
    document.documentElement.style.setProperty("--logo-icon-from", '"/><script>');
    expect(logoIconColours()).toBeNull();
  });
});
