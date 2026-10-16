import { describe, expect, it } from "vitest";
import { extractEmbeds } from "./embeds.js";

const ID = "3f2c1e0a-1b2c-4d5e-8f90-123456789abc";

describe("extractEmbeds", () => {
  it("reads placeholders from HTML in any attribute order", () => {
    const html = `<p>a</p><div class="xt-embed" data-xt-embed="poll" data-id="${ID}"></div>`
      + `<div data-id='x_2' data-xt-embed='poll'></div>`;
    expect(extractEmbeds(html)).toEqual([{ type: "poll", id: ID }, { type: "poll", id: "x_2" }]);
  });

  it("reads xtEmbed nodes from a ProseMirror document, nested", () => {
    const doc = { type: "doc", content: [
      { type: "paragraph" },
      { type: "blockquote", content: [{ type: "xtEmbed", attrs: { type: "poll", id: ID } }] },
    ] };
    expect(extractEmbeds(doc)).toEqual([{ type: "poll", id: ID }]);
  });

  it("keeps duplicates once and ignores malformed refs", () => {
    const html = `<div data-xt-embed="poll" data-id="a"></div><div data-xt-embed="poll" data-id="a"></div>`
      + `<div data-xt-embed="Poll!" data-id="b"></div><div data-xt-embed="poll" data-id="b c"></div>`
      + `<div data-xt-embed="poll"></div>`;
    expect(extractEmbeds(html)).toEqual([{ type: "poll", id: "a" }]);
  });

  it("returns nothing for empty or foreign input", () => {
    expect(extractEmbeds("")).toEqual([]);
    expect(extractEmbeds(null)).toEqual([]);
    expect(extractEmbeds({ type: "doc" })).toEqual([]);
  });
});
