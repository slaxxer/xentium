/**
 * `themeInstallMessage` — the two facts an admin is owed after a theme installs.
 *
 * Both entry points (the Marketplace grid, the Licence panel's owned rows) hit the
 * same endpoint and the same importer, and both used to compose this sentence
 * themselves. They had already drifted once — the Licence panel reported a plugin
 * install for a theme — which is why the sentence lives in one place now.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerBlock, deregisterBlock } from "../../../layout/blockRegistry";
import { themeInstallMessage } from "./themeInstallResult";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** Register a block the way a plugin bundle does, in the browser. */
const havingBlock = (type: string) => {
  registerBlock({ type, schema: z.object({}), component: () => null });
  cleanups.push(() => deregisterBlock(type));
};

/** Renders `key(count, list, name)` so the assertions read on the OUTPUT rather
 *  than on which key was chosen. */
const t = ((key: string, opts?: Record<string, unknown>) =>
  `${key}[${Object.entries(opts ?? {}).map(([k, v]) => `${k}=${v}`).join("|")}]`) as never;

describe("what it always says", () => {
  it("says the theme is STAGED — nothing changed for visitors yet", () => {
    // The single most surprising thing about installing a theme: the site looks
    // identical afterwards, on purpose, and an admin not told that reads it as a
    // failed install.
    expect(themeInstallMessage(t, "Clanforge", { done: true, ok: true }))
      .toBe("marketplace.themeStaged[name=Clanforge]");
  });

  it("says only that when the importer skipped nothing", () => {
    expect(themeInstallMessage(t, "Clanforge", { unknownBlocks: [], unknownTemplates: [] }))
      .toBe("marketplace.themeStaged[name=Clanforge]");
  });
});

describe("what the importer had to leave out", () => {
  it("names the skipped blocks alongside the staging note", () => {
    const msg = themeInstallMessage(t, "Clanforge", {
      unknownBlocks: ["forum.recentThreads", "shoutbox.widget"], unknownTemplates: [],
    });
    expect(msg).toContain("marketplace.themeStaged[name=Clanforge]");
    expect(msg).toContain("count=2");
    expect(msg).toContain("forum.recentThreads, shoutbox.widget");
  });

  it("counts skipped TEMPLATES too — a whole page that did not arrive", () => {
    // A theme carrying `layouts/forum.index.json` on a site without the forum
    // loses an entire page's arrangement, not just a widget.
    const msg = themeInstallMessage(t, "Clanforge", {
      unknownTemplates: ["forum.index"], unknownBlocks: ["forum.categories"],
    });
    expect(msg).toContain("count=2");
    expect(msg).toContain("forum.index, forum.categories");
  });
});

/**
 * ⚠⚠ The regression this file exists for.
 *
 * The API's `KNOWN_BLOCKS` is the CORE catalogue — plugin blocks are registered in
 * the browser, so the server cannot see one and reports every single one as unknown.
 * That is correct for its own purpose (an unrecognised node is KEPT, never rejected,
 * so a theme survives a plugin being disabled) and completely wrong repeated to an
 * admin: it named a block the forum plugin had registered right there, and called it
 * left out when the node was stored and rendering.
 */
describe("the server's list is a candidate set, not the answer", () => {
  it("drops a block this browser can actually render", () => {
    havingBlock("forum.categories");
    expect(themeInstallMessage(t, "Clanforge", { unknownBlocks: ["forum.categories"] }))
      .toBe("marketplace.themeStaged[name=Clanforge]");
  });

  it("keeps only the ones genuinely absent", () => {
    havingBlock("forum.categories");
    const msg = themeInstallMessage(t, "Clanforge", {
      unknownBlocks: ["forum.categories", "shoutbox.widget"],
    });
    expect(msg).toContain("count=1");
    expect(msg).toContain("shoutbox.widget");
    expect(msg).not.toContain("forum.categories");
  });

  it("does NOT filter templates — an unregistered one is really dropped", () => {
    // The server's template registry does include plugin-registered templates, and
    // a layout for a template nobody registered is not stored at all. That list is
    // already the truth.
    havingBlock("forum.index");   // a block of that name must not excuse the template
    expect(themeInstallMessage(t, "Clanforge", { unknownTemplates: ["forum.index"] }))
      .toContain("forum.index");
  });
});

describe("what it refuses to invent", () => {
  it("stays quiet when the stream never delivered a report", () => {
    // A job that failed before its terminal frame has no report. Claiming nothing
    // was skipped would be a promise about an import that may not have finished.
    expect(themeInstallMessage(t, "Clanforge", null)).toBe("marketplace.themeStaged[name=Clanforge]");
    expect(themeInstallMessage(t, "Clanforge", undefined)).toBe("marketplace.themeStaged[name=Clanforge]");
  });

  it("ignores a report whose fields are not arrays", () => {
    // The terminal frame is `[k: string]: unknown` — whatever the server put there.
    expect(themeInstallMessage(t, "Clanforge", { unknownBlocks: "forum.categories" as unknown }))
      .toBe("marketplace.themeStaged[name=Clanforge]");
  });
});
