/**
 * The rail's block library: what it offers, and the two ways out of it.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { deregisterBlock, registerBlock } from "../../../layout/blockRegistry";
import { BlockLibrary, BLOCK_DRAG_TYPE } from "./BlockLibrary";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));

const TYPES = ["lib.alpha", "lib.beta", "lib.gone", "lib.elsewhere"];

beforeEach(() => {
  for (const t of TYPES) deregisterBlock(t);
  const block = (type: string, meta: object) =>
    registerBlock({ type, schema: z.object({}), component: () => null, editorMeta: { label: type, category: "content", ...meta } });
  block("lib.alpha", {});
  block("lib.beta", { category: "structure" });
  block("lib.gone", { retired: true });
  block("lib.elsewhere", { allowedTemplates: ["profile"] });
});
afterEach(() => { cleanup(); for (const t of TYPES) deregisterBlock(t); });

const renderLib = (over: Partial<Parameters<typeof BlockLibrary>[0]> = {}) => {
  const props = {
    templateKey: "home" as const, inserting: false,
    onPick: vi.fn(), onDragStartType: vi.fn(), onDragEndType: vi.fn(),
    onCancelInsert: vi.fn(), onBrowseAll: vi.fn(), ...over,
  };
  render(<BlockLibrary {...props} />);
  return props;
};
const tile = (type: string) => screen.queryAllByRole("button").find((b) => b.textContent?.includes(type));

describe("BlockLibrary", () => {
  it("offers placeable blocks, never retired ones or another template's", () => {
    renderLib();
    expect(tile("lib.alpha")).toBeTruthy();
    expect(tile("lib.beta")).toBeTruthy();
    expect(tile("lib.gone")).toBeUndefined();
    expect(tile("lib.elsewhere")).toBeUndefined();
  });

  it("hands a click to the page, which decides where it lands", () => {
    const p = renderLib();
    fireEvent.click(tile("lib.alpha")!);
    expect(p.onPick).toHaveBeenCalledWith("lib.alpha");
  });

  it("starts a drag that carries the block type and announces it", () => {
    const p = renderLib();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: "" };
    fireEvent.dragStart(tile("lib.alpha")!, { dataTransfer });
    expect(data[BLOCK_DRAG_TYPE]).toBe("lib.alpha");
    expect(p.onDragStartType).toHaveBeenCalledWith("lib.alpha");
    fireEvent.dragEnd(tile("lib.alpha")!);
    expect(p.onDragEndType).toHaveBeenCalled();
  });

  it("filters by search", () => {
    renderLib();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "beta" } });
    expect(tile("lib.alpha")).toBeUndefined();
    expect(tile("lib.beta")).toBeTruthy();
  });

  it("says when a spot is marked, and lets it be cancelled", () => {
    const p = renderLib({ inserting: true });
    fireEvent.click(screen.getByText("layoutEditor.cancel"));
    expect(p.onCancelInsert).toHaveBeenCalled();
  });
});
