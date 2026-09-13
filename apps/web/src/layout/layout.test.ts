/**
 * The layout system's failure rules (ADR-0005).
 *
 * These are the guarantees that stop a stored document — including one inside a
 * theme we did not author — from taking a site down. They are pure logic, so
 * they are cheap to test and expensive to get wrong.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  DEFAULT_LAYOUTS,
  LAYOUT_SCHEMA_VERSION,
  CORE_TEMPLATE_KEYS,
  audienceInView,
  blockTypesIn,
  isBlockVisibleTo,
  isRestricted,
  layoutDocumentSchema,
  missingRequiredBlocks,
  parseLayoutDocument,
  regionsFor,
  validateBlockTree,
} from "@xentium/contracts";
import {
  acceptsChild,
  registerBlock,
  deregisterBlock,
  getBlock,
  listPlaceableBlocks,
} from "./blockRegistry";

const noop = () => null;

describe("parseLayoutDocument — a template always renders", () => {
  it("accepts a valid document", () => {
    const doc = {
      templateKey: "article.index",
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      regions: { main: [{ id: "a", type: "heading", props: { text: "hi" } }] },
    };
    const { document, usedDefault } = parseLayoutDocument("article.index", doc);
    expect(usedDefault).toBe(false);
    expect(document.regions.main).toHaveLength(1);
  });

  it("falls back to the code default when the document is malformed", () => {
    const { document, usedDefault } = parseLayoutDocument("article.index", { nope: true });
    expect(usedDefault).toBe(true);
    expect(document).toEqual(DEFAULT_LAYOUTS["article.index"]);
  });

  it("falls back when the stored document is for a different template", () => {
    // A copy/paste or a bad import must not render the wrong page.
    const other = { ...DEFAULT_LAYOUTS["home"] };
    const { usedDefault } = parseLayoutDocument("article.index", other);
    expect(usedDefault).toBe(true);
  });

  it.each([undefined, null, "", 0, [], "not json"])("falls back for %p", (raw) => {
    const { document, usedDefault } = parseLayoutDocument("home", raw);
    expect(usedDefault).toBe(true);
    expect(document.templateKey).toBe("home");
  });

  it("never throws, whatever it is handed", () => {
    const nasty = { templateKey: "home", regions: { main: [{ id: 1, type: null }] } };
    expect(() => parseLayoutDocument("home", nasty)).not.toThrow();
  });
});

describe("document schema", () => {
  it("keeps unknown block types — they are skipped at render, not dropped on read", () => {
    // Load-bearing: disabling a plugin must not delete the layout an admin built.
    // Re-enabling it has to restore the block exactly where they put it.
    const doc = {
      templateKey: "home",
      regions: { main: [{ id: "x", type: "forum.recentThreads", props: { count: 5 } }] },
    };
    const parsed = layoutDocumentSchema.parse(doc);
    expect(parsed.regions.main?.[0]!.type).toBe("forum.recentThreads");
    expect(parsed.regions.main?.[0]!.props).toEqual({ count: 5 });
  });

  it("supports nested container children", () => {
    const doc = {
      templateKey: "home",
      regions: {
        main: [{
          id: "sec", type: "section", props: {},
          children: [{ id: "h", type: "heading", props: { text: "x" } }],
        }],
      },
    };
    const parsed = layoutDocumentSchema.parse(doc);
    expect(parsed.regions.main?.[0]!.children?.[0]!.type).toBe("heading");
  });

  it("defaults schemaVersion so pre-versioning documents still load", () => {
    const parsed = layoutDocumentSchema.parse({ templateKey: "home", regions: {} });
    expect(parsed.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
  });
});

describe("template set", () => {
  it("ships a default document for every template", () => {
    for (const key of CORE_TEMPLATE_KEYS) {
      expect(DEFAULT_LAYOUTS[key]).toBeDefined();
      expect(DEFAULT_LAYOUTS[key].templateKey).toBe(key);
    }
  });

  it("only uses regions the template declares", () => {
    for (const key of CORE_TEMPLATE_KEYS) {
      const declared = new Set(regionsFor(key));
      for (const region of Object.keys(DEFAULT_LAYOUTS[key].regions)) {
        expect(declared.has(region)).toBe(true);
      }
    }
  });

  it("excludes auth and ACP templates permanently", () => {
    // An admin must never be able to lay out the screen they would need in
    // order to repair a broken layout.
    for (const forbidden of ["login", "register", "admin", "account"]) {
      expect(CORE_TEMPLATE_KEYS).not.toContain(forbidden);
    }
  });
});

describe("blockRegistry", () => {
  beforeEach(() => {
    for (const t of ["t.one", "t.two"]) deregisterBlock(t);
  });

  it("registers and resolves a block", () => {
    registerBlock({ type: "t.one", schema: z.object({}), component: noop });
    expect(getBlock("t.one")).toBeDefined();
  });

  it("deregisters — a disabled plugin's blocks must stop resolving", () => {
    registerBlock({ type: "t.one", schema: z.object({}), component: noop });
    deregisterBlock("t.one");
    expect(getBlock("t.one")).toBeUndefined();
  });

  it("returns undefined for unknown types rather than throwing", () => {
    expect(getBlock("does.not.exist")).toBeUndefined();
  });

  it("filters the picker by template when a block declares allowedTemplates", () => {
    registerBlock({
      type: "t.one", schema: z.object({}), component: noop,
      editorMeta: { label: "One", category: "data", allowedTemplates: ["article.index"] },
    });
    registerBlock({
      type: "t.two", schema: z.object({}), component: noop,
      editorMeta: { label: "Two", category: "content" },
    });
    const onHome = listPlaceableBlocks("home").map((b) => b.type);
    expect(onHome).toContain("t.two");
    expect(onHome).not.toContain("t.one");
  });

  it("omits blocks with no editorMeta from the picker", () => {
    registerBlock({ type: "t.one", schema: z.object({}), component: noop });
    expect(listPlaceableBlocks("home").map((b) => b.type)).not.toContain("t.one");
  });

  it("keeps a container-only block out of a region's picker", () => {
    registerBlock({
      type: "t.one", schema: z.object({}), component: noop,
      editorMeta: { label: "Track", category: "structure", onlyInside: ["t.two"] },
    });
    registerBlock({
      type: "t.two", schema: z.object({}), component: noop, container: true,
      editorMeta: { label: "Row", category: "structure" },
    });
    expect(listPlaceableBlocks("home").map((b) => b.type)).not.toContain("t.one");
    expect(listPlaceableBlocks("home", "t.two").map((b) => b.type)).toContain("t.one");
  });

  it("honours a container's childTypes in both directions", () => {
    registerBlock({
      type: "t.two", schema: z.object({}), component: noop,
      container: true, childTypes: ["t.one"],
      editorMeta: { label: "Row", category: "structure" },
    });
    registerBlock({
      type: "t.one", schema: z.object({}), component: noop,
      editorMeta: { label: "Track", category: "structure" },
    });
    const inside = listPlaceableBlocks("home", "t.two").map((b) => b.type);
    expect(inside).toEqual(["t.one"]);
    expect(acceptsChild("t.two", "t.one")).toBe(true);
    expect(acceptsChild("t.two", "heading")).toBe(false);
  });

  it("refuses any child for a block that is not a container", () => {
    registerBlock({
      type: "t.one", schema: z.object({}), component: noop,
      editorMeta: { label: "Leaf", category: "content" },
    });
    expect(acceptsChild("t.one", "heading")).toBe(false);
    expect(listPlaceableBlocks("home", "t.one")).toEqual([]);
  });
});

/**
 * The rules a document's SHAPE cannot express. Checked on write, because a
 * document that breaks one is not a page to degrade gracefully — it is a document
 * that should never have been stored. The editor cannot produce one; the point of
 * the check is that a hand-written or third-party `.xttheme` can.
 */
describe("validateBlockTree", () => {
  const node = (id: string, type: string, children?: unknown[]) =>
    ({ id, type, props: {}, ...(children ? { children } : {}) }) as never;

  it("accepts a well-formed nested document", () => {
    expect(validateBlockTree({
      main: [node("s", "section", [node("c", "columns", [
        node("c1", "column", [node("h", "heading")]),
        node("c2", "column"),
      ])])],
    })).toEqual([]);
  });

  it("rejects a duplicate id", () => {
    // Both the tree and the preview address a block by id, so a duplicate makes
    // every edit land on whichever node comes first.
    const problems = validateBlockTree({ main: [node("dup", "heading"), node("dup", "spacer")] });
    expect(problems.join(" ")).toContain("Duplicate block id");
  });

  it("rejects a duplicate id across regions", () => {
    const problems = validateBlockTree({
      main:  [node("dup", "heading")],
      aside: [node("dup", "spacer")],
    });
    expect(problems.join(" ")).toContain("Duplicate block id");
  });

  it("rejects nesting past the depth limit", () => {
    let deep = node("d6", "section");
    for (let i = 5; i >= 1; i--) deep = node(`d${i}`, "section", [deep]);
    const problems = validateBlockTree({ main: [deep] }, { maxDepth: 5 });
    expect(problems.join(" ")).toContain("nests deeper than 5");
  });

  it("reports one problem per over-deep branch, not one per node", () => {
    let deep = node("x9", "section");
    for (let i = 8; i >= 1; i--) deep = node(`x${i}`, "section", [deep]);
    expect(validateBlockTree({ main: [deep] }, { maxDepth: 3 })).toHaveLength(1);
  });

  it("rejects children on a core block that cannot hold them", () => {
    const problems = validateBlockTree({ main: [node("h", "heading", [node("k", "spacer")])] });
    expect(problems.join(" ")).toContain('"heading" cannot contain other blocks');
  });

  it("permits children on an unknown type — core cannot know a plugin container", () => {
    expect(validateBlockTree({ main: [node("f", "forum.board", [node("k", "spacer")])] })).toEqual([]);
  });

  it("rejects a column outside a columns row", () => {
    const problems = validateBlockTree({ main: [node("c", "column")] });
    expect(problems.join(" ")).toContain('may only sit inside a "columns"');
  });

  it("rejects a column nested in a section rather than a row", () => {
    const problems = validateBlockTree({ main: [node("s", "section", [node("c", "column")])] });
    expect(problems.join(" ")).toContain('may only sit inside a "columns"');
  });

  it("rejects a non-column child of a columns row", () => {
    const problems = validateBlockTree({ main: [node("c", "columns", [node("h", "heading")])] });
    expect(problems.join(" ")).toContain('may only contain "column" blocks');
  });

  it("reports every problem rather than stopping at the first", () => {
    const problems = validateBlockTree({
      main: [node("dup", "heading"), node("dup", "column")],
    });
    expect(problems.length).toBeGreaterThan(1);
  });
});

/**
 * Audiences narrow, never widen. A block's own gate still decides whether it
 * shows once the audience admits the viewer — so the only thing tested here is
 * who the audience lets through.
 */
describe("isBlockVisibleTo", () => {
  const guest = { signedIn: false, groupIds: [] };
  const member = { signedIn: true, groupIds: ["g-users"] };
  const staff = { signedIn: true, groupIds: ["g-users", "g-admin"] };

  it("treats absent visibility as everyone", () => {
    // Documents written before audiences existed must behave exactly as they did.
    expect(isBlockVisibleTo(undefined, guest)).toBe(true);
    expect(isBlockVisibleTo(undefined, member)).toBe(true);
  });

  it("treats the explicit default as everyone", () => {
    const all = { audience: "everyone" as const, groups: [] };
    expect(isBlockVisibleTo(all, guest)).toBe(true);
    expect(isBlockVisibleTo(all, staff)).toBe(true);
  });

  it("shows a guests-only block to guests alone", () => {
    const v = { audience: "guests" as const, groups: [] };
    expect(isBlockVisibleTo(v, guest)).toBe(true);
    expect(isBlockVisibleTo(v, member)).toBe(false);
  });

  it("shows a members-only block to signed-in viewers alone", () => {
    const v = { audience: "members" as const, groups: [] };
    expect(isBlockVisibleTo(v, guest)).toBe(false);
    expect(isBlockVisibleTo(v, member)).toBe(true);
  });

  it("matches any one of the listed groups", () => {
    // Membership is many-to-many, so belonging to one listed group is enough.
    const v = { audience: "groups" as const, groups: ["g-admin"] };
    expect(isBlockVisibleTo(v, staff)).toBe(true);
    expect(isBlockVisibleTo(v, member)).toBe(false);
  });

  it("never admits a guest to a group-restricted block", () => {
    // Signed out means no groups, so this needs no separate branch.
    expect(isBlockVisibleTo({ audience: "groups", groups: ["g-users"] }, guest)).toBe(false);
  });

  it("resolves an empty group list to nobody", () => {
    // A foot-gun, not an error: the editor warns rather than refusing, because an
    // admin may be mid-edit.
    const v = { audience: "groups" as const, groups: [] };
    expect(isBlockVisibleTo(v, guest)).toBe(false);
    expect(isBlockVisibleTo(v, staff)).toBe(false);
  });

  it("withholds every audience while auth is still resolving", () => {
    // The access token is in memory only (§43), so on the first paint of a page load
    // a signed-in member is indistinguishable from a guest. Taking `signedIn: false`
    // at face value showed a member the entire guest landing — sign-up calls to action
    // included — before it swapped. A beat of nothing beats a beat of the wrong thing.
    const unresolved = { signedIn: false, groupIds: [], resolved: false };
    expect(isBlockVisibleTo({ audience: "guests", groups: [] }, unresolved)).toBe(false);
    expect(isBlockVisibleTo({ audience: "members", groups: [] }, unresolved)).toBe(false);
    expect(isBlockVisibleTo({ audience: "groups", groups: ["g"] }, unresolved)).toBe(false);
  });

  it("still renders unrestricted blocks while auth is resolving", () => {
    // Otherwise the page would be blank rather than partial.
    const unresolved = { signedIn: false, groupIds: [], resolved: false };
    expect(isBlockVisibleTo(undefined, unresolved)).toBe(true);
    expect(isBlockVisibleTo({ audience: "everyone", groups: [] }, unresolved)).toBe(true);
  });

  it("treats an omitted `resolved` as settled", () => {
    // A caller that knows — a test, the server — need not say so.
    expect(isBlockVisibleTo({ audience: "guests", groups: [] }, { signedIn: false, groupIds: [] }))
      .toBe(true);
  });

  it("reports only a real restriction as restricted", () => {
    expect(isRestricted(undefined)).toBe(false);
    expect(isRestricted({ audience: "everyone", groups: [] })).toBe(false);
    expect(isRestricted({ audience: "members", groups: [] })).toBe(true);
  });
});

describe("validateBlockTree — required blocks cannot be restricted", () => {
  const node = (type: string, visibility?: unknown) =>
    ({ id: type, type, props: {}, ...(visibility ? { visibility } : {}) }) as never;

  it("refuses an audience on a required block", () => {
    // Restricting `logo` to a group would hide it from everyone else, achieving by
    // audience exactly what deleting it is forbidden to do.
    const problems = validateBlockTree(
      { left: [node("logo", { audience: "groups", groups: ["g-admin"] })] },
      { requiredTypes: ["logo", "userMenu"] },
    );
    expect(problems.join(" ")).toContain("required and cannot be limited");
  });

  it("allows the explicit default on a required block", () => {
    expect(validateBlockTree(
      { left: [node("logo", { audience: "everyone", groups: [] })] },
      { requiredTypes: ["logo"] },
    )).toEqual([]);
  });

  it("refuses a required block restricted while nested", () => {
    const problems = validateBlockTree(
      { left: [{ id: "s", type: "section", props: {}, children: [
        node("userMenu", { audience: "members", groups: [] }),
      ] }] as never },
      { requiredTypes: ["userMenu"] },
    );
    expect(problems.join(" ")).toContain("required and cannot be limited");
  });

  it("allows an audience on any other block", () => {
    expect(validateBlockTree(
      { left: [node("whosOnline", { audience: "members", groups: [] })] },
      { requiredTypes: ["logo", "userMenu"] },
    )).toEqual([]);
  });

  it("applies no such rule when no required types are given", () => {
    expect(validateBlockTree({ left: [node("logo", { audience: "members", groups: [] })] })).toEqual([]);
  });
});

describe("blockTypesIn — required blocks survive being nested", () => {
  it("finds a type at any depth", () => {
    const doc = {
      regions: {
        left: [{ id: "s", type: "section", props: {}, children: [{ id: "l", type: "logo", props: {} }] }],
      },
    };
    expect(blockTypesIn(doc as never).has("logo")).toBe(true);
  });

  it("does not report a required block as missing once an admin nests it", () => {
    // Dropping the header's logo into a section MOVES it. A shallow scan would
    // refuse the save as "missing logo", which is the save an admin just made.
    const doc = {
      templateKey: "chrome.header" as const,
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      regions: {
        left: [{ id: "s", type: "section", props: {}, children: [
          { id: "l", type: "logo", props: {} },
          { id: "u", type: "userMenu", props: {} },
        ] }],
        center: [], right: [],
      },
    };
    expect(missingRequiredBlocks("chrome.header", doc)).toEqual([]);
  });
});

/**
 * The editor's audience axis.
 *
 * Deliberately not `isBlockVisibleTo` with a synthetic viewer: a viewer has concrete
 * groups, so a `groups`-restricted block would drop out of the "members" view for want
 * of the right group — when a group is a subset of members and plainly belongs there.
 */
describe("audienceInView", () => {
  const vis = (audience: string) => ({ audience, groups: [] }) as never;

  it("has no third view — every block belongs to one of the two", () => {
    // There is deliberately no "everyone" view: an unrestricted block appears in
    // both, so nothing can hide from the editor.
    for (const a of ["everyone", "guests", "members", "groups"]) {
      const reachable = audienceInView(vis(a), "guests") || audienceInView(vis(a), "members");
      expect(reachable, a).toBe(true);
    }
    expect(audienceInView(undefined, "guests") || audienceInView(undefined, "members")).toBe(true);
  });

  it("counts unrestricted blocks as part of every arrangement", () => {
    expect(audienceInView(undefined, "guests")).toBe(true);
    expect(audienceInView(undefined, "members")).toBe(true);
    expect(audienceInView(vis("everyone"), "guests")).toBe(true);
  });

  it("separates the guest arrangement from the member one", () => {
    expect(audienceInView(vis("guests"), "guests")).toBe(true);
    expect(audienceInView(vis("guests"), "members")).toBe(false);
    expect(audienceInView(vis("members"), "members")).toBe(true);
    expect(audienceInView(vis("members"), "guests")).toBe(false);
  });

  it("treats a group restriction as part of the member arrangement", () => {
    // The distinction from a concrete viewer, and the reason this helper exists.
    expect(audienceInView(vis("groups"), "members")).toBe(true);
    expect(audienceInView(vis("groups"), "guests")).toBe(false);
  });
});
