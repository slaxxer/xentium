/**
 * The Activity Log's sentences: a route becomes words, ids become names, and every
 * phrase the table can produce is translated in every bundled language.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { browserOf, humanize, VERB_KEYS } from "./activityHumanize";

describe("humanize", () => {
  it("names a user target from the server's targets", () => {
    const h = humanize("POST", "/api/admin/users/9c71f0e7-96ca-4669-9ab9-b7118b68049a/ban", {
      "9c71f0e7-96ca-4669-9ab9-b7118b68049a": "@spamlord",
    });
    expect(h).toMatchObject({ verbKey: "userBanned", target: "@spamlord" });
  });

  it("names a group target the same way", () => {
    expect(humanize("PATCH", "/api/admin/groups/g1/permissions", { g1: "Moderator" }))
      .toMatchObject({ verbKey: "groupPermissions", target: "Moderator" });
  });

  it("shortens an unnamed id and keeps a key whole", () => {
    expect(humanize("PATCH", "/api/admin/error-log/groups/121af96cf284665759c88027").target).toBe("121af96c");
    expect(humanize("PUT", "/api/admin/settings/site.name").target).toBe("site.name");
  });

  it("matches on the method too", () => {
    expect(humanize("POST", "/api/admin/users/u1/ban").verbKey).toBe("userBanned");
    expect(humanize("DELETE", "/api/admin/users/u1/ban").verbKey).toBe("userUnbanned");
    expect(humanize("POST", "/api/admin/users").verbKey).toBe("userCreated");
  });

  it("falls back to the area for a route it does not know", () => {
    expect(humanize("PATCH", "/api/admin/some-plugin/thing")).toMatchObject({ verbKey: "genericChange", area: "some plugin" });
    expect(humanize("DELETE", "/api/admin/x/1").verbKey).toBe("genericDelete");
  });
});

describe("browserOf", () => {
  it("reads browser and system", () => {
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"))
      .toBe("Chrome 129 · Windows");
    expect(browserOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"))
      .toBe("Safari 18 · macOS");
    expect(browserOf(null)).toBe("");
  });
});

describe("translations", () => {
  for (const lang of ["en", "de", "es", "fr", "pt"]) {
    it(`${lang} has every verb`, () => {
      const acp = JSON.parse(readFileSync(resolve(__dirname, `../../../../public/locales/${lang}/acp.json`), "utf8"));
      const missing = VERB_KEYS.filter((k) => typeof acp.activity?.verb?.[k] !== "string");
      expect(missing).toEqual([]);
    });
  }
});
