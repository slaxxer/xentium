/**
 * Which set draws an icon, and what is refused outright.
 *
 * @vitest-environment jsdom
 *
 * ⚠ The bundled set must WIN. Core's chrome cannot depend on a third-party script
 * having loaded, so a name core already has must never route through the kit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppIcon } from "./AppIcon";

const kit = vi.hoisted(() => ({ loaded: false }));
vi.mock("../lib/iconKit", () => ({
  iconKitReady: () => kit.loaded,
  useIconStyle: () => null,   // the wrapper stays on the bundled set in these tests
}));

afterEach(() => { cleanup(); kit.loaded = false; });

describe("with no kit configured", () => {
  it("draws a bundled icon as an svg", () => {
    const { container } = render(<AppIcon name="faStar" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  /** Not a broken box, not a missing-glyph square — nothing. */
  it("draws nothing for a name it does not have", () => {
    const { container } = render(<AppIcon name="faDragon" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("with a kit on the page", () => {
  /** ⚠ The whole point: no network dependency for an icon we already ship. */
  it("still prefers the bundled icon", () => {
    kit.loaded = true;
    const { container } = render(<AppIcon name="faStar" />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("i")).toBeNull();
  });

  it("hands an unbundled name to the kit as a solid class", () => {
    kit.loaded = true;
    const { container } = render(<AppIcon name="faDragon" />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-solid fa-dragon");
  });

  it("splits a camelCase name into a kebab class", () => {
    kit.loaded = true;
    const { container } = render(<AppIcon name="faUserAstronaut" />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-solid fa-user-astronaut");
  });

  /** An admin naming a Pro style directly — the reason Pro is worth paying for. */
  it("passes a full class string through, so a Pro style can be named", () => {
    kit.loaded = true;
    const { container } = render(<AppIcon name="fa-duotone fa-dragon" />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-duotone fa-dragon");
  });
});

describe("what never reaches the DOM", () => {
  /**
   * ⚠ This string is written as raw HTML, and icon names are admin-supplied. The
   * charset is closed for exactly this reason.
   */
  it("refuses anything outside the class charset", () => {
    kit.loaded = true;
    for (const name of [
      'fa-solid" onload="alert(1)',
      "fa-solid fa-star><script>alert(1)</script>",
      "fa-solid/../x",
      "fa-SOLID fa-star",
    ]) {
      const { container } = render(<AppIcon name={name} />);
      expect(container.querySelector("script")).toBeNull();
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("refuses a name that is neither our shape nor a class", () => {
    kit.loaded = true;
    const { container } = render(<AppIcon name="Star" />);
    expect(container.innerHTML).toBe("");
  });
});
