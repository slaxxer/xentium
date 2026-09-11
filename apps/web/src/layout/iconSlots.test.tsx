/**
 * Numbering icons inside a block, and applying one override.
 *
 * @vitest-environment jsdom
 *
 * ⚠ These tests exist because the first implementation was WRONG in a way that only
 * production would have shown: it counted during render, so React's double-invoked
 * render made the first icon claim `#1` in development and `#0` in production. A key
 * written by the editor would not have matched the key the live site computed.
 * `StrictMode` is therefore not incidental here — it is the regression guard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { faGear, faStar } from "@fortawesome/free-solid-svg-icons";
import { IconSlotProvider } from "./iconSlots";
import { FontAwesomeIcon } from "../components/Icon";

vi.mock("../lib/iconKit", () => ({ useIconStyle: () => null, useIconKitReady: () => false }));
vi.mock("./previewMode", () => ({ isEditorPreview: () => true }));

afterEach(cleanup);

const slots = (c: HTMLElement) =>
  [...c.querySelectorAll("[data-nv-icon]")].map((e) => (e as HTMLElement).dataset.nvIcon);

function Block({ overrides }: { overrides?: Record<string, string> }) {
  return (
    <IconSlotProvider blockId="b1" overrides={overrides}>
      <FontAwesomeIcon icon={faGear} />
      <FontAwesomeIcon icon={faStar} />
      <FontAwesomeIcon icon={faGear} />
    </IconSlotProvider>
  );
}

describe("numbering", () => {
  it("numbers each name from zero, independently", () => {
    const { container } = render(<Block />);
    expect(slots(container)).toEqual(["b1::gear#0", "b1::star#0", "b1::gear#1"]);
  });

  /** ⚠ The bug this file exists for. */
  it("numbers identically under StrictMode's double render", () => {
    const { container } = render(<StrictMode><Block /></StrictMode>);
    expect(slots(container)).toEqual(["b1::gear#0", "b1::star#0", "b1::gear#1"]);
  });

  /**
   * ⚠ A re-render must not renumber. An override already stored against `gear#1`
   * would otherwise land on a different icon the next time anything changed.
   */
  it("keeps its slot across re-renders", () => {
    const { container, rerender } = render(<Block />);
    rerender(<Block overrides={{ "star#0": "rocket" }} />);
    expect(slots(container)).toEqual(["b1::gear#0", "b1::star#0", "b1::gear#1"]);
  });
});

describe("applying an override", () => {
  it("replaces only the slot it names", () => {
    const { container } = render(<Block overrides={{ "gear#1": "rocket" }} />);
    // No kit here, so it resolves to the BUNDLED icon of that name.
    const drawn = [...container.querySelectorAll("svg")].map((s) => s.getAttribute("data-icon"));
    expect(drawn).toEqual(["gear", "star", "rocket"]);
  });

  /**
   * ⚠ The slot key stays anchored to what the CODE asked for, never to what it was
   * replaced with. If overriding `gear#0` renamed its slot to `rocket#0`, the
   * override would lose its own anchor and could not be edited or cleared again.
   */
  it("keeps the original name as the slot key", () => {
    const { container } = render(<Block overrides={{ "gear#0": "rocket" }} />);
    expect(slots(container)[0]).toBe("b1::gear#0");
  });

  /**
   * ⚠ A hole where a control used to be is worse than the wrong-but-present icon.
   * `dragon` is not bundled and there is no kit, so the code's own icon stands.
   */
  it("falls back to the original when the replacement cannot be drawn", () => {
    const { container } = render(<Block overrides={{ "gear#0": "dragon" }} />);
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe("gear");
  });

  it("draws normally when the block has no overrides", () => {
    const { container } = render(<Block />);
    const drawn = [...container.querySelectorAll("svg")].map((s) => s.getAttribute("data-icon"));
    expect(drawn).toEqual(["gear", "star", "gear"]);
  });
});

describe("outside a block", () => {
  /** Core chrome that is not part of any layout draws exactly as it always did. */
  it("marks nothing and overrides nothing", () => {
    const { container } = render(<FontAwesomeIcon icon={faGear} />);
    expect(container.querySelector("[data-nv-icon]")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
