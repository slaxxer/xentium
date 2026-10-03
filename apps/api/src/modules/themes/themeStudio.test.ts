/**
 * Theme Studio's style count: what the draft bar says is unpublished.
 */
import { describe, expect, it } from "vitest";
import { countTokenChanges } from "./themeStudio.js";

describe("countTokenChanges", () => {
  it("counts added, changed and removed values across scopes", () => {
    const live = { global: { "--c-accent": "#111", "--c-bg": "#fff" }, navbar: { "--nav-bg": "#000" } };
    const draft = { global: { "--c-accent": "#222", "--c-bg": "#fff", "--c-fg": "#333" } };
    // accent changed, fg added, navbar's nav-bg removed
    expect(countTokenChanges(draft, live)).toBe(3);
  });

  it("is zero when nothing differs", () => {
    const set = { global: { "--c-accent": "#111" } };
    expect(countTokenChanges(set, structuredClone(set))).toBe(0);
  });
});
