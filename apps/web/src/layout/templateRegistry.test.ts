/**
 * The template registry (ADR-0005 Amendment 3).
 *
 * A plugin may declare a template for a page it owns. Everything here is about the
 * boundary of that permission: what a plugin may add, what it must never be able to
 * take over, and what happens to an admin's work when the plugin goes away.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  CORE_TEMPLATE_KEYS,
  DEFAULT_LAYOUTS,
  LAYOUT_SCHEMA_VERSION,
  defaultLayoutFor,
  deregisterTemplatesFor,
  getTemplate,
  isKnownTemplate,
  listTemplates,
  parseLayoutDocument,
  regionsFor,
  registerTemplate,
  requiredBlocksFor,
  templateKeySchema,
  templateKeys,
} from "@nodevo/contracts";

const PLUGIN = "nodevo-testplug";

/** A minimal valid declaration; each test overrides the part it is about. */
const decl = (over: Record<string, unknown> = {}) => ({
  key:      "testplug.index",
  label:    "Test index",
  pluginId: PLUGIN,
  regions:  ["header", "main"],
  defaultDocument: {
    templateKey: "testplug.index",
    regions: { main: [{ id: "x", type: "heading", props: { text: "hi" } }] },
  },
  ...over,
});

afterEach(() => {
  deregisterTemplatesFor(PLUGIN);
  deregisterTemplatesFor("other-plugin");
});

describe("core templates", () => {
  it("are all registered at module load", () => {
    for (const key of CORE_TEMPLATE_KEYS) expect(isKnownTemplate(key)).toBe(true);
    expect(templateKeys()).toEqual(expect.arrayContaining([...CORE_TEMPLATE_KEYS]));
  });

  it("keep their declared regions and required blocks", () => {
    // The site header is ONE region, because the navbar is IN the header rather than
    // beside it — it is a `navbar` block, so ordering a masthead against it is
    // ordering blocks in a list.
    expect(regionsFor("chrome.header")).toEqual(["header"]);
    expect(regionsFor("chrome.footer")).toEqual(["footer"]);
    // ⚠ ORDER is the contract, not just membership: this array is the render order
    // AND the editor's Structure order, so a region that drifted would render in the
    // wrong place while still reading correctly as a set.
    expect(regionsFor("article.detail")).toEqual(["main", "aside"]);
    /**
     * ⚠ The SIGN-IN only. The logo used to be required too, and a site whose navbar
     * deliberately has none — the mark already fills the `header` band above it —
     * could not save that. A way home is not one block's job (the nav links are one,
     * the band's own logo is another); being unable to sign in is the thing an admin
     * cannot undo from the front end.
     */
    expect(requiredBlocksFor("chrome.header")).toEqual(["userMenu"]);
    expect(requiredBlocksFor("home")).toBeUndefined();
  });

  /**
   * The registry stores the PARSED default, not the literal. Zod emits object keys in
   * schema order and the literal in contracts does not, and every draft-vs-live
   * comparison in this system is a `JSON.stringify` — an unparsed default would make
   * an untouched template read as customised forever.
   */
  it("store the default document parsed, so it compares equal to a stored copy", () => {
    for (const key of CORE_TEMPLATE_KEYS) {
      const stored = defaultLayoutFor(key);
      const reparsed = parseLayoutDocument(key, DEFAULT_LAYOUTS[key]).document;
      expect(JSON.stringify(stored)).toBe(JSON.stringify(reparsed));
    }
  });
});

describe("what a plugin may register", () => {
  it("accepts a namespaced template and makes it known everywhere", () => {
    registerTemplate(decl());
    expect(isKnownTemplate("testplug.index")).toBe(true);
    expect(regionsFor("testplug.index")).toEqual(["header", "main"]);
    expect(getTemplate("testplug.index")?.pluginId).toBe(PLUGIN);
    expect(listTemplates().some((t) => t.key === "testplug.index")).toBe(true);
  });

  it("fills in schemaVersion and empty props, so a declaration states only what it means", () => {
    registerTemplate(decl());
    const doc = defaultLayoutFor("testplug.index");
    expect(doc.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(doc.regions.main![0]!.props).toEqual({ text: "hi" });
  });

  /** The one refusal that is a security boundary rather than hygiene. */
  it("REFUSES a core template key", () => {
    for (const key of CORE_TEMPLATE_KEYS) {
      expect(() => registerTemplate(decl({
        key, defaultDocument: { templateKey: key, regions: {} },
      }))).toThrow(/core template/i);
    }
    // …and core's own definition is untouched by the attempt.
    expect(getTemplate("home")?.pluginId).toBeUndefined();
  });

  it("REFUSES another plugin's template key", () => {
    registerTemplate(decl());
    expect(() => registerTemplate(decl({ pluginId: "other-plugin" })))
      .toThrow(/already registered by nodevo-testplug/);
  });

  it("ALLOWS a plugin to re-register its own template — every enable does", () => {
    registerTemplate(decl());
    registerTemplate(decl({ regions: ["header", "main", "aside"] }));
    expect(regionsFor("testplug.index")).toEqual(["header", "main", "aside"]);
  });

  it("REFUSES a bare key, so a plugin cannot squat a word core might want", () => {
    expect(() => registerTemplate(decl({
      key: "dashboard", defaultDocument: { templateKey: "dashboard", regions: {} },
    }))).toThrow(/namespaced/);
  });

  it("REFUSES an off-origin preview route — it loads in an ACP iframe", () => {
    expect(() => registerTemplate(decl({ previewRoute: "https://example.test/x" })))
      .toThrow(/same-origin/);
    expect(() => registerTemplate(decl({ previewRoute: "//example.test/x" })))
      .toThrow(/same-origin/);
    expect(() => registerTemplate(decl({ previewRoute: "/forum" }))).not.toThrow();
  });

  it("REFUSES no regions, duplicate regions and a region name that is not one", () => {
    expect(() => registerTemplate(decl({ regions: [] }))).toThrow(/no regions/);
    expect(() => registerTemplate(decl({ regions: ["main", "main"] }))).toThrow(/twice/);
    expect(() => registerTemplate(decl({ regions: ["main", "side-bar"] }))).toThrow(/valid region name/);
  });
});

describe("the default document is held to what a save is held to", () => {
  it("REFUSES a document for a different template", () => {
    expect(() => registerTemplate(decl({
      defaultDocument: { templateKey: "home", regions: {} },
    }))).toThrow(/declares template "home"/);
  });

  it("REFUSES a region the template does not declare", () => {
    expect(() => registerTemplate(decl({
      defaultDocument: { templateKey: "testplug.index", regions: { nope: [] } },
    }))).toThrow(/undeclared region/);
  });

  it("REFUSES a broken block tree — duplicate ids, a stray column", () => {
    expect(() => registerTemplate(decl({
      defaultDocument: {
        templateKey: "testplug.index",
        regions: { main: [
          { id: "dup", type: "heading", props: {} },
          { id: "dup", type: "heading", props: {} },
        ] },
      },
    }))).toThrow(/Duplicate block id/);

    expect(() => registerTemplate(decl({
      defaultDocument: {
        templateKey: "testplug.index",
        regions: { main: [{ id: "c", type: "column", props: {} }] },
      },
    }))).toThrow(/may only sit inside/);
  });

  it("REFUSES a document missing a block the template says it requires", () => {
    expect(() => registerTemplate(decl({
      requiredBlocks: ["heading"],
      defaultDocument: { templateKey: "testplug.index", regions: { main: [] } },
    }))).toThrow(/invalid|missing/i);
  });

  it("registers nothing at all when the declaration is refused", () => {
    expect(() => registerTemplate(decl({ regions: [] }))).toThrow();
    expect(isKnownTemplate("testplug.index")).toBe(false);
  });
});

describe("disabling the plugin", () => {
  it("removes the template and reports what it removed", () => {
    registerTemplate(decl());
    registerTemplate(decl({
      key: "testplug.other",
      defaultDocument: { templateKey: "testplug.other", regions: {} },
    }));

    const removed = deregisterTemplatesFor(PLUGIN);
    expect(removed.sort()).toEqual(["testplug.index", "testplug.other"]);
    expect(isKnownTemplate("testplug.index")).toBe(false);
    // Core is untouched — deregistration is per plugin, not a reset.
    expect(isKnownTemplate("home")).toBe(true);
  });

  /**
   * The forward-compatibility rule, at template scale. A document stored for a
   * template nobody registers must still PARSE (so the row survives) and must render
   * as nothing (so the page does not throw) — exactly what an unknown block does.
   */
  it("leaves a document for the gone template parseable, and rendering nothing", () => {
    const stored = {
      templateKey: "testplug.index",
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      regions: { main: [{ id: "x", type: "heading", props: { text: "hi" } }] },
    };
    registerTemplate(decl());
    deregisterTemplatesFor(PLUGIN);

    // The key is still key-SHAPED, which is what keeps the row readable…
    expect(templateKeySchema.safeParse("testplug.index").success).toBe(true);
    // …the document still parses…
    const { document, usedDefault } = parseLayoutDocument("testplug.index", stored);
    expect(usedDefault).toBe(false);
    expect(document.regions.main).toHaveLength(1);
    // …and with no template to say what order its regions render in, nothing does.
    expect(regionsFor("testplug.index")).toEqual([]);
    expect(defaultLayoutFor("testplug.index").regions).toEqual({});
  });
});
