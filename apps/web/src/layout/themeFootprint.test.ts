/**
 * `themeGaps` — the check that has to happen before the Install button.
 *
 * The importer's behaviour under a missing plugin is deliberate and good: it
 * SKIPS the block and keeps the rest, so disabling a plugin never destroys an
 * admin's arrangement. It is also the exact behaviour that makes a freshly bought
 * theme look broken, because the admin has no reason to connect "half of this is
 * blank" with "I do not own the forum". Every case below is really the same
 * question — does the ACP get to warn, and does it warn about something true.
 */
import { afterEach, describe, expect, it } from "vitest";
import { registerBlock, deregisterBlock } from "./blockRegistry";
import { themeGaps, blocksThisSiteCannotDraw } from "./themeFootprint";
import { z } from "zod";

const stub = (type: string) => {
  registerBlock({ type, schema: z.object({}), component: () => null });
  return () => deregisterBlock(type);
};

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

describe("what counts as a gap", () => {
  it("names a block type nothing is registered for", () => {
    expect(themeGaps({ usesTemplates: [], usesBlocks: ["forum.recentThreads"] }))
      .toEqual({ blocks: ["forum.recentThreads"], templates: [] });
  });

  it("says nothing about a block this site HAS", () => {
    cleanups.push(stub("forum.recentThreads"));
    expect(themeGaps({ usesTemplates: [], usesBlocks: ["forum.recentThreads"] })).toBeNull();
  });

  it("names a template key the registry does not know", () => {
    const gaps = themeGaps({ usesTemplates: ["forum.index"], usesBlocks: [] });
    expect(gaps?.templates).toEqual(["forum.index"]);
  });

  it("says nothing about core templates, which every site has", () => {
    // The core eight are seeded through the same `registerTemplate` a plugin
    // uses, so this is a real registry lookup, not a hardcoded list.
    expect(themeGaps({ usesTemplates: ["home", "members", "profile"], usesBlocks: [] })).toBeNull();
  });

  it("reports both halves together, since one card carries one warning", () => {
    const gaps = themeGaps({ usesTemplates: ["forum.index"], usesBlocks: ["forum.categories"] });
    expect(gaps).toEqual({ templates: ["forum.index"], blocks: ["forum.categories"] });
  });
});

describe("absent is not the same answer as empty", () => {
  /**
   * THE distinction. An EMPTY footprint is a walked package that needs nothing
   * beyond core — a real all-clear. An ABSENT one is a theme the marketplace
   * listed before footprints existed, and it means we have not looked. Rendering
   * the second as the first would put a silent card in front of a buyer and call
   * it reassurance.
   */
  it("warns about nothing when a walked package needs nothing this site lacks", () => {
    // `heading` is a core block, registered by `coreBlocks` at app boot rather
    // than by this module — so it is stubbed here for the same reason the plugin
    // blocks are: the unit under test is the lookup, not core's inventory.
    cleanups.push(stub("heading"));
    expect(themeGaps({ usesTemplates: ["home"], usesBlocks: ["heading"] })).toBeNull();
  });

  it("stays silent — not falsely reassuring — when the footprint was never recorded", () => {
    expect(themeGaps({})).toBeNull();
    expect(themeGaps({ usesBlocks: ["forum.categories"] })).toBeNull();
    expect(themeGaps({ usesTemplates: ["forum.index"] })).toBeNull();
  });
});

describe("what it refuses to guess", () => {
  /**
   * A plugin's id (`nodevo-forum`) and its block namespace (`forum.`) are
   * different strings on purpose — `BlockDefinition.pluginId` exists precisely
   * because one cannot be derived from the other. The mapping lives inside the
   * plugin's own registration, which a site missing that plugin does not have,
   * so "you need the Forum plugin" is not a sentence this can honestly produce.
   */
  it("reports the type, never an invented plugin id", () => {
    const gaps = themeGaps({ usesTemplates: [], usesBlocks: ["forum.recentThreads"] });
    expect(gaps!.blocks).toEqual(["forum.recentThreads"]);
    expect(JSON.stringify(gaps)).not.toContain("nodevo-forum");
  });

  it("does not credit a namespace for a block it does not actually have", () => {
    // Holding ONE of a plugin's blocks says nothing about the others: a site can
    // register a block from a bundle whose other halves it lacks.
    cleanups.push(stub("forum.recentThreads"));
    const gaps = themeGaps({ usesTemplates: [], usesBlocks: ["forum.recentThreads", "forum.categories"] });
    expect(gaps!.blocks).toEqual(["forum.categories"]);
  });
});

/**
 * ⚠⚠ The bug this guards, found only by looking at a running site.
 *
 * The API's `KNOWN_BLOCKS` is the CORE catalogue. Plugin blocks are registered by
 * plugin code in the BROWSER, so the server cannot see one and reports every plugin
 * block as unknown — correct for its own purpose (an unrecognised node is KEPT, never
 * rejected, so a theme survives its plugin being disabled) and false the moment it is
 * repeated to an admin. Both report surfaces printed it verbatim, so a site running
 * the forum plugin was told that `forum.categories` could not be rendered while it
 * was on screen — and the pre-purchase card, which checks the real registry, had said
 * the opposite about the same theme minutes earlier.
 */
describe("blocksThisSiteCannotDraw", () => {
  it("removes a block a plugin registered in this browser", () => {
    cleanups.push(stub("forum.categories"));
    expect(blocksThisSiteCannotDraw(["forum.categories"])).toEqual([]);
  });

  it("keeps the ones that really have no block", () => {
    cleanups.push(stub("forum.categories"));
    expect(blocksThisSiteCannotDraw(["forum.categories", "shoutbox.widget"]))
      .toEqual(["shoutbox.widget"]);
  });

  it("agrees with the pre-purchase card about the same site", () => {
    // The two surfaces answer one question and must never disagree: a card
    // promising two gaps and a report announcing three is worse than either alone.
    cleanups.push(stub("forum.categories"));
    const used = ["forum.categories", "shoutbox.widget"];
    const card = themeGaps({ usesTemplates: [], usesBlocks: used })!.blocks;
    expect(blocksThisSiteCannotDraw(used)).toEqual(card);
  });
});
