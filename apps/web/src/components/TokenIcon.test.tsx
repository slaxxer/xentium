/**
 * Resolving a stored icon token.
 *
 * @vitest-environment jsdom
 *
 * ⚠ The fallback ORDER is the contract: pinned style → site style → bundled free →
 * nothing. The middle two are conveniences; the third is the promise that a site
 * which loses its kit still looks finished rather than gap-toothed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TokenIcon } from "./TokenIcon";

const kit = vi.hoisted(() => ({ ready: false, style: null as string | null }));
vi.mock("../lib/iconKit", () => ({
  useIconKitReady: () => kit.ready,
  useIconStyle:    () => kit.style,
}));

afterEach(() => { cleanup(); kit.ready = false; kit.style = null; });

const cls = (c: Element | null) => c?.querySelector("i")?.getAttribute("class") ?? null;

describe("with no kit", () => {
  /** ⚠ THE PROMISE. A pin is a preference; the icon is the thing that matters. */
  it("falls back to the bundled icon even when a Pro style is pinned", () => {
    const { container } = render(<TokenIcon token="jelly-regular:star" />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("i")).toBeNull();
  });

  it("draws a bundled icon for a plain name", () => {
    const { container } = render(<TokenIcon token="star" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  /** Core does not ship this one, and there is no kit to ask. */
  it("draws nothing for a name it does not bundle", () => {
    const { container } = render(<TokenIcon token="dragon" />);
    expect(container.innerHTML).toBe("");
  });

  it("reads a legacy camelCase name", () => {
    const { container } = render(<TokenIcon token="faStar" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("with a kit loaded", () => {
  it("honours a pinned style", () => {
    kit.ready = true;
    const { container } = render(<TokenIcon token="jelly-regular:star" />);
    expect(cls(container)).toBe("fa-jelly fa-regular fa-star");
  });

  /**
   * ⚠ A pin BEATS the site style — that is the entire point of pinning, and the
   * reason the two are stored separately.
   */
  it("prefers the pin over the site's own style", () => {
    kit.ready = true; kit.style = "fa-duotone fa-solid";
    const { container } = render(<TokenIcon token="thin:star" />);
    expect(cls(container)).toBe("fa-thin fa-star");
  });

  it("reaches the kit for a name core does not bundle", () => {
    kit.ready = true; kit.style = "fa-duotone fa-solid";
    const { container } = render(<TokenIcon token="dragon" />);
    expect(cls(container)).toBe("fa-duotone fa-solid fa-dragon");
  });

  /** ⚠ A pin to Solid means "the icons core ships", not a class to emit. */
  it("treats a pin to solid as the bundled set", () => {
    kit.ready = true;
    const { container } = render(<TokenIcon token="solid:star" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  /**
   * ⚠ An unknown style degrades to FOLLOWING THE SITE, not to a dead class and not
   * to the bundled set. The name is the part the admin chose; a style id that no
   * longer exists is the part we are entitled to drop.
   */
  it("ignores a style that no longer exists and follows the site", () => {
    kit.ready = true; kit.style = "fa-light";
    const { container } = render(<TokenIcon token="madeup:star" />);
    expect(cls(container)).toBe("fa-light fa-star");
  });
});

describe("what never reaches the DOM", () => {
  it("refuses names outside the charset", () => {
    kit.ready = true; kit.style = "fa-light";
    for (const tok of ['star" onload="alert(1)', "star<script>", "../x", "STAR"]) {
      const { container } = render(<TokenIcon token={tok} />);
      expect(container.querySelector("script")).toBeNull();
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("renders nothing for an absent token", () => {
    const { container } = render(<TokenIcon token={null} />);
    expect(container.innerHTML).toBe("");
  });
});
