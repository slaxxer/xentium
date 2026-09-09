/**
 * The background panel's two honesty rules.
 *
 * @vitest-environment jsdom
 *
 * 1. Clearing a background must CLEAR the prop, not store an empty array. An empty
 *    array and an absent key draw the same thing, but draft-vs-published is a
 *    `JSON.stringify` comparison — so a block left holding `backgroundGradient: []`
 *    reads as changed for ever, the toolbar reports an edit that was undone, and a
 *    theme update declines the template as customised. Found in the real dev
 *    document, not by a test: the footer carried `[]` after one add-then-remove.
 * 2. An empty panel must not claim "no background" for a block the STYLE EDITOR
 *    paints. The footer's band is `--footer-bg` whether or not this panel holds
 *    anything, so what is empty here is the OVERRIDE.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import { BlockBackgroundFields } from "./BlockBackground";

afterEach(cleanup);

const panel = (over: Partial<Parameters<typeof BlockBackgroundFields>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <BlockBackgroundFields
      image={undefined} gradient={undefined} angle={undefined}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
};

const removeStopButton = () =>
  [...document.querySelectorAll("button")]
    .filter((b) => b.title === "layoutEditor.bgRemoveStop");

describe("clearing a gradient", () => {
  it("clears the prop when the last stop goes, rather than storing []", () => {
    const { onChange } = panel({ gradient: ["#101219"] });
    fireEvent.click(removeStopButton()[0]!);
    expect(onChange).toHaveBeenCalledWith({ backgroundGradient: undefined });
  });

  it("keeps the remaining stops when there is more than one", () => {
    const { onChange } = panel({ gradient: ["#101219", "#1b1e36"] });
    fireEvent.click(removeStopButton()[0]!);
    expect(onChange).toHaveBeenCalledWith({ backgroundGradient: ["#1b1e36"] });
  });

  it("survives a round trip — add then remove leaves nothing behind", () => {
    // The exact sequence that put `[]` into the dev document.
    const { onChange } = panel({ gradient: ["#101219"] });
    fireEvent.click(removeStopButton()[0]!);
    const patch = onChange.mock.calls[0]![0] as Record<string, unknown>;
    // What matters is what SURVIVES `JSON.stringify`, which is what gets saved.
    expect(JSON.parse(JSON.stringify({ showTopBorder: true, ...patch })))
      .toEqual({ showTopBorder: true });
  });
});

describe("what an empty panel says", () => {
  it("says 'no background' for an ordinary block", () => {
    panel();
    expect(screen.getByText("layoutEditor.bgNone")).toBeTruthy();
  });

  it("says it INHERITS for a block the Style Editor already paints", () => {
    panel({ inherits: true });
    expect(screen.getByText("layoutEditor.bgInherits")).toBeTruthy();
    expect(screen.queryByText("layoutEditor.bgNone")).toBeNull();
  });

  it("says neither once there is something to show", () => {
    panel({ inherits: true, gradient: ["#101219", "#1b1e36"] });
    expect(screen.queryByText("layoutEditor.bgInherits")).toBeNull();
    expect(screen.queryByText("layoutEditor.bgNone")).toBeNull();
  });
});
