import { describe, expect, it } from "vitest";
import { toneOfClass } from "./types.js";

describe("toneOfClass", () => {
  it.each([
    ["label label--red", "danger"], ["badge green", "success"], ["label--orange", "warning"],
    ["badge blue", "info"], ["label--primary", "accent"], ['<span style="color:green">Solved</span>', "success"],
    ["", "neutral"], [null, "neutral"], ["label--silver", "neutral"],
  ])("%s → %s", (css, tone) => expect(toneOfClass(css)).toBe(tone));
});
