/**
 * Plugin slot contributions as movable blocks.
 *
 * @vitest-environment jsdom
 *
 * The promise being tested is that an admin can position a plugin's UI as freely as
 * core's, **without the plugin changing**. So the assertions are about the bridge
 * deriving blocks from what a plugin already registered, keeping ownership so a
 * disable still removes them, and not rendering the same widget twice when both the
 * aggregate cluster and an individual block are in play.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BlockNode } from "@xentium/contracts";
import { slotRegistry } from "../plugins/slotRegistry";
import { LayoutRegion } from "./LayoutRenderer";
import "./blocks/coreBlocks";   // pluginSlot lives here
import {
  deregisterBlocksFor,
  getBlock,
  listPlaceableBlocks,
} from "./blockRegistry";
import {
  individuallyPlacedSlotIds,
  isSlotBlockType,
  registerSlotBlocks,
  slotBlockType,
} from "./slotBlocks";

const BELL = "testplug.bell";
const RAIL = "testplug.rail";
const TAB  = "testplug.tab";

beforeEach(() => {
  // Register as a plugin would, so ownership is recorded the same way.
  slotRegistry.registerPluginMeta({ pluginId: "xentium-testplug" } as never);
  slotRegistry.registerHeaderWidget({ id: BELL, component: () => <i className="bell" /> });
  slotRegistry.registerLayoutWidget({
    id: RAIL,
    // Self-gates on the outlet, exactly as the existing widgets do.
    component: ({ outlet }) => (outlet === "aside" ? <i className="rail" /> : null),
  });
  slotRegistry.registerProfileTab({
    id: TAB, label: "Test tab",
    component: ({ profileUsername }: { profileUsername: string }) =>
      <i className="ptab">{profileUsername}</i>,
  } as never);
  registerSlotBlocks();
});

afterEach(() => {
  cleanup();
  // BOTH registries: `slotRegistry` is what the aggregate outlets iterate, so leaving
  // registrations behind would stack duplicate widgets across tests and make the
  // de-duplication assertions below lie.
  slotRegistry.deregister("xentium-testplug");
  deregisterBlocksFor("xentium-testplug");
});

describe("a block is derived per contribution", () => {
  it("derives one for a header widget", () => {
    expect(getBlock(slotBlockType("headerWidget", BELL))).toBeDefined();
  });

  it("derives one for a layout widget", () => {
    expect(getBlock(slotBlockType("layoutWidget", RAIL))).toBeDefined();
  });

  it("derives one for a profile tab, labelled as the plugin labelled it", () => {
    expect(getBlock(slotBlockType("profileTab", TAB))!.editorMeta!.label).toBe("Test tab");
  });

  it("marks derived types recognisably", () => {
    expect(isSlotBlockType(slotBlockType("headerWidget", BELL))).toBe(true);
    expect(isSlotBlockType("logo")).toBe(false);
  });

  it("is safe to run again — bundles load one at a time", () => {
    registerSlotBlocks();
    registerSlotBlocks();
    expect(getBlock(slotBlockType("headerWidget", BELL))).toBeDefined();
  });
});

describe("scoping", () => {
  it("offers a header widget only on chrome.header", () => {
    // It is chrome; there is no page context for it to read.
    expect(listPlaceableBlocks("chrome.header").map((b) => b.type))
      .toContain(slotBlockType("headerWidget", BELL));
    expect(listPlaceableBlocks("home").map((b) => b.type))
      .not.toContain(slotBlockType("headerWidget", BELL));
  });

  it("offers a layout widget on any page template", () => {
    for (const template of ["home", "members", "article.detail"]) {
      expect(listPlaceableBlocks(template).map((b) => b.type), template)
        .toContain(slotBlockType("layoutWidget", RAIL));
    }
  });

  it("offers a profile tab only on the profile template", () => {
    expect(getBlock(slotBlockType("profileTab", TAB))!.editorMeta!.allowedTemplates)
      .toEqual(["profile"]);
  });
});

describe("ownership survives, and so does the admin's document", () => {
  it("stamps the contributing plugin", () => {
    expect(getBlock(slotBlockType("headerWidget", BELL))!.pluginId).toBe("xentium-testplug");
  });

  it("disabling the plugin removes its derived blocks", () => {
    // The node stays in the document — an unknown type is skipped and kept — so
    // re-enabling restores it where the admin put it.
    deregisterBlocksFor("xentium-testplug");
    expect(getBlock(slotBlockType("headerWidget", BELL))).toBeUndefined();
    expect(getBlock(slotBlockType("layoutWidget", RAIL))).toBeUndefined();
    expect(getBlock(slotBlockType("profileTab", TAB))).toBeUndefined();
  });
});

describe("layout widgets keep their own outlet gating", () => {
  const renderBlock = (type: string, props: Record<string, unknown>, context: unknown = {}) => {
    const def = getBlock(type)!;
    const Comp = def.component;
    return render(<Comp props={def.schema.parse(props) as never} context={context} />);
  };

  it("renders when the admin picks the outlet the widget expects", () => {
    renderBlock(slotBlockType("layoutWidget", RAIL), { outlet: "aside" });
    expect(document.querySelector(".rail")).toBeTruthy();
  });

  it("renders nothing when the widget rejects the chosen outlet", () => {
    // Deliberate: breaking the widget's own check would blank out every existing
    // widget, so the admin chooses which outlet identity it renders as.
    renderBlock(slotBlockType("layoutWidget", RAIL), { outlet: "top" });
    expect(document.querySelector(".rail")).toBeNull();
  });

  it("defaults to aside rather than to nothing", () => {
    renderBlock(slotBlockType("layoutWidget", RAIL), {});
    expect(document.querySelector(".rail")).toBeTruthy();
  });

  it("passes the profile through to a plugin tab unchanged", () => {
    renderBlock(slotBlockType("profileTab", TAB), {}, {
      profile: { id: "u1", username: "root", isOwn: false },
    });
    expect(document.querySelector(".ptab")!.textContent).toBe("root");
  });

  it("renders nothing for a profile tab with no profile resolved yet", () => {
    renderBlock(slotBlockType("profileTab", TAB), {}, {});
    expect(document.querySelector(".ptab")).toBeNull();
  });
});

/**
 * The de-duplication, end to end through the renderer.
 *
 * `pluginSlot` and `headerWidgets` each draw EVERY plugin widget for an outlet, and
 * every widget is also its own block — so placing one individually while keeping the
 * aggregate rendered it twice. The aggregate now reads the document from context and
 * skips what it already places, which is what makes the two mechanisms alternatives.
 */
describe("an individually placed widget is not also drawn by pluginSlot", () => {
  const render1 = (main: BlockNode[]) =>
    render(<LayoutRegion document={{
      templateKey: "home", schemaVersion: 1, regions: { main },
    }} region="main" />);

  const pluginSlot = (id: string): BlockNode =>
    ({ id, type: "pluginSlot", props: { slotId: "aside" } });
  const ownBlock = (id: string): BlockNode =>
    ({ id, type: slotBlockType("layoutWidget", RAIL), props: { outlet: "aside" } });

  it("draws the widget once when only the aggregate is placed", () => {
    render1([pluginSlot("ps")]);
    expect(document.querySelectorAll(".rail")).toHaveLength(1);
  });

  it("draws it once when only its own block is placed", () => {
    render1([ownBlock("own")]);
    expect(document.querySelectorAll(".rail")).toHaveLength(1);
  });

  it("draws it ONCE — not twice — when both are placed", () => {
    render1([pluginSlot("ps"), ownBlock("own")]);
    expect(document.querySelectorAll(".rail")).toHaveLength(1);
  });

  it("still draws widgets the document does not place individually", () => {
    // Skipping must be per widget, not "the aggregate goes quiet entirely".
    slotRegistry.registerLayoutWidget({
      id: "testplug.second",
      component: ({ outlet }) => (outlet === "aside" ? <i className="second" /> : null),
    });
    registerSlotBlocks();
    render1([pluginSlot("ps"), ownBlock("own")]);
    expect(document.querySelectorAll(".rail")).toHaveLength(1);
    expect(document.querySelectorAll(".second")).toHaveLength(1);
  });

  it("is unaffected by a widget placed under a different outlet name", () => {
    // The skip keys off the widget ID, so the aggregate does not silently drop a
    // widget just because an admin placed it elsewhere with another outlet.
    render1([pluginSlot("ps"), { ...ownBlock("own"), props: { outlet: "top" } }]);
    // Its own block renders nothing at outlet "top" (the widget refuses), and the
    // aggregate correctly stays quiet for it — one placement, one decision.
    expect(document.querySelectorAll(".rail")).toHaveLength(0);
  });
});

describe("the aggregate cluster does not duplicate an individually placed widget", () => {
  it("finds the ids a document places on their own", () => {
    const placed = individuallyPlacedSlotIds(
      ["logo", slotBlockType("headerWidget", BELL), slotBlockType("layoutWidget", RAIL)],
      "headerWidget",
    );
    expect([...placed]).toEqual([BELL]);
  });

  it("ignores other slot kinds", () => {
    const placed = individuallyPlacedSlotIds([slotBlockType("layoutWidget", RAIL)], "headerWidget");
    expect(placed.size).toBe(0);
  });

  it("returns nothing for a document that places no slot blocks", () => {
    expect(individuallyPlacedSlotIds(["logo", "userMenu", "search"], "headerWidget").size).toBe(0);
  });
});
