import { describe, expect, it } from "vitest";
import { cliSiteDir } from "./envProbe.js";

describe("cliSiteDir", () => {
  it("finds the site of an install made by the xentium CLI", () => {
    expect(cliSiteDir("/srv/xentium/shared/.env")).toBe("/srv/xentium");
  });

  it("says nothing for a clone or any other layout", () => {
    expect(cliSiteDir(undefined)).toBeNull();
    expect(cliSiteDir("/home/me/xentium/.env")).toBeNull();
    expect(cliSiteDir("/srv/xentium/shared/prod.env")).toBeNull();
  });
});
