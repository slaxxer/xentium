/**
 * @vitest-environment jsdom
 *
 * The layout documents the server inlines into index.html seed the first render, so
 * a page shows the site's arrangement at once instead of the code default.
 */
import { afterEach, describe, expect, it } from "vitest";
import { takeInlinedLayouts } from "./useLayout";

function inline(theme: string, body: string) {
  const el = document.createElement("script");
  el.id = "xentium-layouts";
  el.type = "application/json";
  el.dataset.theme = theme;
  el.textContent = body;
  document.head.appendChild(el);
}

afterEach(() => {
  document.getElementById("xentium-layouts")?.remove();
  document.cookie = "xt_theme=; path=/; max-age=0";
});

describe("takeInlinedLayouts", () => {
  it("reads the site's documents once", () => {
    inline("", JSON.stringify({ templates: { home: { v: 1 } }, variants: {} }));
    expect(takeInlinedLayouts()).toEqual({ templates: { home: { v: 1 } }, variants: {} });
    // ⚠ A second query must fetch: the inlined set may be stale by then.
    expect(takeInlinedLayouts()).toBeUndefined();
  });

  it("is ignored when it was served for a different theme than the reader now wears", () => {
    document.cookie = "xt_theme=redline; path=/";
    inline("", JSON.stringify({ templates: {}, variants: {} }));
    expect(takeInlinedLayouts()).toBeUndefined();

    inline("redline", JSON.stringify({ templates: { home: { v: 2 } }, variants: {} }));
    expect(takeInlinedLayouts()?.templates).toEqual({ home: { v: 2 } });
  });

  it("falls back to fetching on anything unreadable", () => {
    inline("", "{not json");
    expect(takeInlinedLayouts()).toBeUndefined();
  });
});
