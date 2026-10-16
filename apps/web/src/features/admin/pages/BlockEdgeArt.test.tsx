/**
 * The stand-in a plugin shape stores for sites without the plugin.
 *
 * @vitest-environment jsdom
 *
 * Picking a plugin shape stores ITS `fallback`, and switching to another shape replaces
 * it — a stand-in left over from the previous shape would make a site without the
 * plugin draw the wrong outline, and nobody looking at a site WITH the plugin would
 * ever see it.
 */
import { useState } from "react";
import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import type { BlockEdges } from "@xentium/contracts";
import { BlockEdgeArtFields } from "./BlockEdgeArt";
import { deregisterEdgeFor, registerEdgeShape } from "../../../layout/edgeRegistry";

afterEach(cleanup);

beforeAll(() => {
  deregisterEdgeFor("test-plugin");
  const unit = { base: () => 0, unit: (x: number, w: number) => ` L ${x - w} 0` };
  registerEdgeShape({ id: "tst.round", labelKey: "tst.round", unit, pluginId: "test-plugin", fallback: "scallops" });
  registerEdgeShape({ id: "tst.soft", labelKey: "tst.soft", unit, pluginId: "test-plugin", fallback: "wave" });
  registerEdgeShape({ id: "tst.bare", labelKey: "tst.bare", unit, pluginId: "test-plugin" });
});

/** The panel with its own state, so a click sees the edge the previous click wrote. */
function panel(initial?: BlockEdges) {
  const seen: (BlockEdges | undefined)[] = [];
  function Host() {
    const [value, setValue] = useState(initial);
    return <BlockEdgeArtFields value={value} onChange={(next) => { seen.push(next); setValue(next); }} />;
  }
  render(<Host />);
  return { last: () => seen.at(-1)?.bottom };
}

/** A tile in the shape grid (the stand-in select below lists core shapes too). */
const pick = (label: string) =>
  fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".lay-edge__shape")]
    .find((b) => b.textContent === label)!);

describe("a plugin shape's stand-in", () => {
  it("is stored when the shape is picked on a side with no edge", () => {
    const { last } = panel();
    pick("tst.soft");
    expect(last()).toMatchObject({ shape: "tst.soft", fallback: "wave" });
  });

  it("is replaced, not kept, when switching from one plugin shape to another", () => {
    const { last } = panel();
    pick("tst.round");
    expect(last()?.fallback).toBe("scallops");
    pick("tst.soft");
    expect(last()).toMatchObject({ shape: "tst.soft", fallback: "wave" });
  });

  it("is dropped when the new shape declares none, or is a core shape", () => {
    const { last } = panel();
    pick("tst.round");
    pick("tst.bare");
    expect(last()?.shape).toBe("tst.bare");
    expect(last()).not.toHaveProperty("fallback");
    pick("tst.round");
    pick("layoutEditor.edge.shape.wave");
    expect(last()?.shape).toBe("wave");
    expect(last()).not.toHaveProperty("fallback");
  });
});
