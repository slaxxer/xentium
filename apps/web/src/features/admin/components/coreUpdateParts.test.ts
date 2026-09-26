import { describe, expect, it } from "vitest";
import { isPrerelease, updateCommands, type CoreUpdate } from "./coreUpdateParts";

const release = (version: string) => ({ version, severity: "normal" as const, publishedAt: null, notes: null, upgradeNotes: null });
const update = (over: Partial<CoreUpdate> = {}): CoreUpdate => ({
  current: "1.0.0-alpha.7", latest: release("1.0.0-alpha.8"), highestSeverity: "normal", urgentRelease: null,
  releaseCount: 1, via: null, blockedBy: [], checkedAt: "", patch: null, acknowledged: false,
  path: [release("1.0.0-alpha.8")], siteDir: "/srv/xentium", ...over,
});

describe("the update command", () => {
  it("names the version and updates the CLI first", () => {
    // A bare `xentium update` installs npm's `latest`, which a prerelease never is.
    expect(updateCommands(update())).toEqual([
      "cd /srv/xentium",
      "npm install xentium@1.0.0-alpha.8",
      "npx xentium update 1.0.0-alpha.8",
    ]);
  });

  it("goes to the stepping stone when the jump is refused", () => {
    expect(updateCommands(update({ via: "1.0.0-alpha.7" })).at(-1)).toBe("npx xentium update 1.0.0-alpha.7");
  });

  it("leaves out the directory when it doesn't know it", () => {
    expect(updateCommands(update({ siteDir: null }))[0]).toBe("npm install xentium@1.0.0-alpha.8");
  });
});

describe("isPrerelease", () => {
  it("tells an alpha from a release", () => {
    expect(isPrerelease("1.0.0-alpha.8")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
  });
});
