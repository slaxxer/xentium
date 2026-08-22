/**
 * Every template must actually render something.
 *
 * @vitest-environment jsdom
 *
 * This is the regression guard for the bug that prompted the bulk adoption: five of
 * the eight templates were offered by the layout editor — an admin could compose
 * them, autosave, publish, watch "pending" clear — and were wired to nothing,
 * because their `DEFAULT_LAYOUTS` entries were all-empty regions and no page
 * rendered them.
 *
 * Nothing in typecheck, lint or the other suites can see that. What it looks like
 * is a template whose default document places no blocks, so that is what is
 * asserted here: no template ships empty, and every type a default references is a
 * type the registry actually knows.
 *
 * jsdom because registering the whole catalogue pulls in the real page components.
 */
import { describe, expect, it } from "vitest";
import {
  CORE_CONTAINER_TYPES,
  DEFAULT_LAYOUTS,
  CORE_TEMPLATE_KEYS,
  blockPropSchemas,
  blockTypesIn,
  regionsFor,
  validateBlockTree,
  type TemplateKey,
} from "@nodevo/contracts";
import { getBlock } from "./blockRegistry";

// The full catalogue, exactly as main.tsx registers it.
import "./blocks/coreBlocks";
import "./blocks/chromeBlocks";
import "./blocks/pageDetailBlocks";
import "./blocks/pageTemplateBlocks";
import "./blocks/profileBlocks";
import "./blocks/memberBlocks";
import "./blocks/homeBlocks";
import "./blocks/guestBlocks";

/** The block each page template is expected to place, post-adoption. */
const EXPECTED_ANCHOR: Record<TemplateKey, string> = {
  "home":           "homeFeed",
  "article.index":  "articleIndex",
  "article.detail": "articleDetail",
  "page.detail":    "pageBody",
  "profile":        "profileCard",
  "members":        "membersList",
  "chrome.header":  "logo",
  "chrome.footer":  "branding",
};

describe("no template is offered while wired to nothing", () => {
  it.each(CORE_TEMPLATE_KEYS)("%s places at least one block by default", (key) => {
    const total = Object.values(DEFAULT_LAYOUTS[key].regions)
      .reduce((n, nodes) => n + nodes.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it.each(CORE_TEMPLATE_KEYS)("%s places the block that renders its page", (key) => {
    expect([...blockTypesIn(DEFAULT_LAYOUTS[key])]).toContain(EXPECTED_ANCHOR[key]);
  });
});

describe("defaults reference only real blocks", () => {
  it.each(CORE_TEMPLATE_KEYS)("every block type in %s is registered", (key) => {
    // An unknown type is skipped and kept at render, which is right for a theme
    // outliving a plugin — but a type WE ship a default referencing would just be
    // an invisible region.
    for (const type of blockTypesIn(DEFAULT_LAYOUTS[key])) {
      expect(getBlock(type), `${key} → ${type}`).toBeDefined();
    }
  });

  it.each(CORE_TEMPLATE_KEYS)("every region in %s is one the template declares", (key) => {
    const declared = new Set(regionsFor(key));
    for (const region of Object.keys(DEFAULT_LAYOUTS[key].regions)) {
      expect(declared.has(region), `${key} → ${region}`).toBe(true);
    }
  });

  it.each(CORE_TEMPLATE_KEYS)("%s satisfies the tree rules it will be saved against", (key) => {
    // A default that the API would refuse is a default an admin cannot re-save
    // after touching it.
    expect(validateBlockTree(DEFAULT_LAYOUTS[key].regions)).toEqual([]);
  });
});

describe("page blocks are scoped to their own template", () => {
  it.each([
    ["guestSurface", "home"],
    ["guestHeroText", "home"],
    ["guestRail", "home"],
    ["homeFeed", "home"],
    ["homeMeCard", "home"],
    ["homeHotThreads", "home"],
    ["membersTabs", "members"],
    ["membersFilters", "members"],
    ["membersList", "members"],
    ["membersTeam", "members"],
    ["articleDetail", "article.detail"],
    ["profileCard", "profile"],
    ["profileAvatar", "profile"],
    ["profileIdentity", "profile"],
    ["profileStats", "profile"],
    ["profileTabs", "profile"],
    ["pageBody", "page.detail"],
    ["pageTitle", "page.detail"],
    ["pageImage", "page.detail"],
  ] as const)("%s is only placeable on %s", (type, template) => {
    // These read their page's own data, so offering them elsewhere would put a
    // block on a page that cannot feed it.
    expect(getBlock(type)!.editorMeta!.allowedTemplates).toEqual([template]);
  });

  it("keeps CORE_CONTAINER_TYPES and the registry's `container` flag in step", () => {
    // The two lists are deliberately separate — the API has no registry — so they
    // can drift. A core container missing from the contract makes the API refuse a
    // layout the editor built; one listed but not flagged lets a document store
    // children the renderer will never render.
    const flagged = [...CORE_CONTAINER_TYPES].filter((t) => getBlock(t)?.container).sort();
    expect(flagged).toEqual([...CORE_CONTAINER_TYPES].sort());

    for (const type of Object.keys(blockPropSchemas)) {
      const isContainer = !!getBlock(type)?.container;
      const inContract = (CORE_CONTAINER_TYPES as readonly string[]).includes(type);
      expect(isContainer, `${type}: registry container=${isContainer}, contract=${inContract}`)
        .toBe(inContract);
    }
  });

  it("carries no props on a whole-page block", () => {
    // A data-selecting prop is what turns a block into theme-authored
    // configuration over access — the thing "blocks render, the host fetches"
    // exists to prevent.
    for (const type of ["articleDetail"]) {
      const shape = getBlock(type)!.schema.safeParse({});
      expect(shape.success, type).toBe(true);
      expect(shape.data, type).toEqual({});
    }
  });
});
