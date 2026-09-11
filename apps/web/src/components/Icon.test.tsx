/**
 * The icon wrapper every core file and every plugin now draws through.
 *
 * @vitest-environment jsdom
 *
 * ⚠ The important half is the FALLBACK. This component sits under all 373 icon call
 * sites in the app, so "no kit, or a kit that has not loaded, renders exactly what
 * we rendered before any of this existed" is the whole safety story. A regression
 * here is every icon in the product at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { faStar, faUserAstronaut } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "./Icon";

const kit = vi.hoisted(() => ({ style: null as string | null }));
vi.mock("../lib/iconKit", () => ({ useIconStyle: () => kit.style }));

afterEach(() => { cleanup(); kit.style = null; });

describe("with no kit, or a kit that has not loaded", () => {
  /** ⚠ The default install, and every install that never buys Pro. */
  it("draws the bundled free icon as an svg", () => {
    const { container } = render(<FontAwesomeIcon icon={faStar} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("i")).toBeNull();
  });

  it("passes className and style straight through", () => {
    const { container } = render(
      <FontAwesomeIcon icon={faStar} className="mine" style={{ color: "red" }} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("mine");
    expect(svg.getAttribute("style")).toContain("red");
  });
});

describe("with a Pro style active", () => {
  it("hands the icon's own name to the kit", () => {
    kit.style = "fa-light";
    const { container } = render(<FontAwesomeIcon icon={faStar} />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-light fa-star");
    expect(container.querySelector("svg")).toBeNull();
  });

  /** ⚠ Only the NAME is read from the free definition. No Pro artwork is bundled. */
  it("reads multi-word names correctly", () => {
    kit.style = "fa-duotone";
    const { container } = render(<FontAwesomeIcon icon={faUserAstronaut} />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-duotone fa-user-astronaut");
  });

  it("carries the sharp family through as two classes", () => {
    kit.style = "fa-sharp fa-light";
    const { container } = render(<FontAwesomeIcon icon={faStar} />);
    expect(container.querySelector("i")?.getAttribute("class")).toBe("fa-sharp fa-light fa-star");
  });

  it("keeps className and the spin prop", () => {
    kit.style = "fa-light";
    const { container } = render(<FontAwesomeIcon icon={faStar} spin className="mine" />);
    const cls = container.querySelector("i")?.getAttribute("class") ?? "";
    expect(cls).toContain("fa-spin");
    expect(cls).toContain("mine");
  });

  it("keeps inline styles on the wrapper", () => {
    kit.style = "fa-light";
    const { container } = render(<FontAwesomeIcon icon={faStar} style={{ color: "red" }} />);
    expect(container.querySelector("span")?.getAttribute("style")).toContain("red");
  });

  /**
   * ⚠ Anything we cannot confidently NAME falls back rather than being guessed at.
   * An array or string icon prop is valid FontAwesome and must keep working.
   */
  it("falls back for an icon it cannot name", () => {
    kit.style = "fa-light";
    for (const icon of [["fas", "star"] as never, "star" as never, undefined as never]) {
      const { container } = render(<FontAwesomeIcon icon={icon} />);
      expect(container.querySelector("i")).toBeNull();
      cleanup();
    }
  });
});
