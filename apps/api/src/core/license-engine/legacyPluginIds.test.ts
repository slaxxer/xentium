import { describe, it, expect } from "vitest";
import { productIdAliases } from "./legacyPluginIds.js";

describe("productIdAliases", () => {
  it("answers to the pre-rename id as well as its own", () => {
    expect(productIdAliases("xentium-forum")).toEqual(["xentium-forum", "nodevo-forum"]);
  });

  it("leaves an id with no legacy spelling alone", () => {
    expect(productIdAliases("layout-blocks-pro")).toEqual(["layout-blocks-pro"]);
  });

  it("does not make an old id valid on its own", () => {
    // Only the NEW id gains an alias. A claim for nodevo-forum authorises
    // xentium-forum; nothing authorises a plugin still installed under the old
    // id beyond its own name, and no `nodevo-` prefix is treated as ours.
    expect(productIdAliases("nodevo-forum")).toEqual(["nodevo-forum"]);
    expect(productIdAliases("nodevo-somebody-elses-plugin")).toEqual(["nodevo-somebody-elses-plugin"]);
  });
});
