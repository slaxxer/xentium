/**
 * `resolveComposerConfig` — the guard between a settings row and the editor.
 *
 * Its input is a JSON blob that survives backup restores, hand edits and older
 * versions of the tool list, and its output decides what every member's toolbar
 * renders. Every case here is one a real row can be in.
 */
import { describe, expect, it } from "vitest";
import {
  COMPOSER_DEFAULT_CONFIG, COMPOSER_TOOL_IDS, resolveComposerConfig,
  type ComposerToolId,
} from "./composer.js";

const where = (raw: unknown, id: ComposerToolId) =>
  resolveComposerConfig(raw).tools.find((t) => t.id === id)?.where;

describe("resolving a composer config", () => {
  /**
   * ⚠ Nothing in, nothing in the bar — and that is CORRECT. An admin who empties
   * the bar stores `{bar: []}` and must get an empty bar. The shipped default for a
   * site that never opened the page is applied by the ENDPOINT, which distinguishes
   * a missing row from a stored empty one; the resolver only resolves what it is
   * given.
   */
  it("answers an empty bar for junk, and never throws", () => {
    for (const raw of [null, undefined, "", 0, [], "not json at all"]) {
      const { config } = resolveComposerConfig(raw);
      expect(config.bar).toEqual([]);
      expect(config.mentions).toBe(true);   // on unless switched off explicitly
    }
  });

  it("keeps the bar's ORDER — it is the order members see", () => {
    const { config } = resolveComposerConfig({ bar: ["italic", "link", "bold"], off: [] });
    expect(config.bar).toEqual(["italic", "link", "bold"]);
  });

  /** Everything an admin did not mention is in the tray, never missing. */
  it("puts every unlisted tool in the overflow tray", () => {
    const { tools } = resolveComposerConfig({ bar: ["bold"], off: [] });
    expect(tools).toHaveLength(COMPOSER_TOOL_IDS.length);
    expect(where({ bar: ["bold"], off: [] }, "bold")).toBe("bar");
    expect(where({ bar: ["bold"], off: [] }, "superscript")).toBe("overflow");
  });

  /**
   * ⚠ `off` is the final word. The two lists are edited by one page but stored as a
   * blob, and a tool in both must not come back to life.
   */
  it("lets `off` beat `bar` when a row contradicts itself", () => {
    expect(where({ bar: ["bold"], off: ["bold"] }, "bold")).toBe("off");
    const { config } = resolveComposerConfig({ bar: ["bold", "italic"], off: ["bold"] });
    expect(config.bar).toEqual(["italic"]);
  });

  it("drops ids it does not know, rather than rendering a hole", () => {
    const { config, tools } = resolveComposerConfig({
      bar: ["bold", "teleport", 7, null, "italic"],
      off: ["blink"],
    });
    expect(config.bar).toEqual(["bold", "italic"]);
    expect(config.off).toEqual([]);
    expect(tools.every((t) => (COMPOSER_TOOL_IDS as readonly string[]).includes(t.id))).toBe(true);
  });

  it("de-duplicates, so one tool cannot be drawn twice", () => {
    const { config } = resolveComposerConfig({ bar: ["bold", "bold", "italic", "bold"], off: [] });
    expect(config.bar).toEqual(["bold", "italic"]);
  });

  it("survives a row whose lists are not arrays", () => {
    const { config } = resolveComposerConfig({ bar: "bold", off: { bold: true }, mentions: "yes" });
    expect(config.bar).toEqual([]);
    expect(config.off).toEqual([]);
    // ⚠ Only a real boolean switches mentions off; a truthy string is a broken row.
    expect(config.mentions).toBe(true);
  });

  it("honours mentions being switched off", () => {
    expect(resolveComposerConfig({ bar: [], off: [], mentions: false }).config.mentions).toBe(false);
  });

  /** The shipped default has to survive its own resolver unchanged. */
  it("round-trips the default config", () => {
    const { config } = resolveComposerConfig(COMPOSER_DEFAULT_CONFIG);
    expect(config).toEqual(COMPOSER_DEFAULT_CONFIG);
    expect(config.bar).toHaveLength(6);
  });

  it("groups every tool, so the tray can lay them out", () => {
    const { tools } = resolveComposerConfig(COMPOSER_DEFAULT_CONFIG);
    for (const tool of tools) {
      expect(["marks", "blocks", "align", "insert"]).toContain(tool.group);
    }
  });
});
