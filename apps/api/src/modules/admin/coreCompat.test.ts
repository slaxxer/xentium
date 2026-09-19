/**
 * Which plugins block a core update.
 *
 * The failure this prevents is specific: an admin clicks update, the site goes
 * into maintenance mode, migrations run, and only then does a plugin refuse to
 * load. The window is declared in every manifest and there is no reason to
 * discover it late — so the card says it, with names, before anyone commits.
 */
import { describe, expect, it } from "vitest";
import { pluginsBlocking, type InstalledManifest } from "./coreCompat.js";

const plugin = (id: string, min?: string, max?: string): InstalledManifest => ({
  id, name: id,
  manifest: { ...(min ? { minXentiumVersion: min } : {}), ...(max ? { maxXentiumVersion: max } : {}) },
});

describe("pluginsBlocking", () => {
  it("passes a plugin whose window contains the target", () => {
    expect(pluginsBlocking("1.2.0", [plugin("forum", "1.0")])).toEqual([]);
    expect(pluginsBlocking("1.2.0", [plugin("forum", "1.0", "1.2")])).toEqual([]);
  });

  it("blocks a plugin whose ceiling is below the target, and says what it supports", () => {
    expect(pluginsBlocking("1.3.0", [plugin("forum", "1.0", "1.2")])).toEqual([
      { id: "forum", name: "forum", supports: "1.0–1.2" },
    ]);
  });

  it("blocks a plugin that needs a NEWER core than the target", () => {
    // Downgrades and stepping stones both land here.
    expect(pluginsBlocking("1.0.0", [plugin("shoutbox", "1.2")])).toHaveLength(1);
  });

  it("matches what enable-time compatibility actually does, including its sharp edge", () => {
    // ⚠ `compareBaseVersions` fills a missing patch with 0, so a ceiling of
    // "1.2" means 1.2.0 and NOT the 1.2 line: 1.2.9 is outside it. That is what
    // `assertCompatible` already does when a plugin is enabled, so the card has
    // to say the same thing — a card that promised an update the plugin engine
    // would then refuse would be worse than a blunt one.
    expect(pluginsBlocking("1.2.0", [plugin("forum", "1.0", "1.2")])).toEqual([]);
    expect(pluginsBlocking("1.2.9", [plugin("forum", "1.0", "1.2")])).toHaveLength(1);
  });

  it("does not block a plugin that declares nothing", () => {
    // We have no idea what it supports. Refusing every core update because an
    // old plugin was vague would make the feature unusable on the very sites
    // that most need it.
    expect(pluginsBlocking("9.9.9", [{ id: "old", name: "old", manifest: null }])).toEqual([]);
    expect(pluginsBlocking("9.9.9", [plugin("vague")])).toEqual([]);
  });

  it("does not write a range when the floor and ceiling are the same version", () => {
    // "supports 1.0–1.0" is a range with one member, and reads like a mistake.
    expect(pluginsBlocking("1.1.0", [plugin("forum", "1.0", "1.0")])[0]!.supports).toBe("1.0");
  });

  it("names every blocker, not just the first", () => {
    const blockers = pluginsBlocking("2.0.0", [
      plugin("forum", "1.0", "1.2"), plugin("ok", "1.0"), plugin("shoutbox", "1.0", "1.5"),
    ]);
    expect(blockers.map((b) => b.id)).toEqual(["forum", "shoutbox"]);
  });
});
