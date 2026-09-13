/**
 * `isDraftLayout` vs `isLayoutPreview` — two questions that used to be one.
 *
 * @vitest-environment jsdom
 *
 * "Render the draft" and "show the editor's affordances" were a single predicate,
 * because for a long time there was only one caller: the Layout Editor's iframe,
 * which wants both. Previewing a staged THEME wants the first and emphatically not
 * the second — and the first version of that feature painted empty-region drop
 * targets labelled HEADER and FOOTER across the page, so an admin deciding whether
 * to keep a theme was shown the editor rather than their site.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  editingTemplate,
  isDraftLayout,
  isLayoutPreview,
  LAYOUT_EDITING_PARAM,
  LAYOUT_PREVIEW_PARAM,
} from "./useLayout";

const setUrl = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};
afterEach(() => setUrl(""));

describe("reading the draft", () => {
  it("is on for the editor's mode", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=draft`);
    expect(isDraftLayout()).toBe(true);
  });

  it("is on for the theme preview's mode", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=preview`);
    expect(isDraftLayout()).toBe(true);
  });

  it("is off on an ordinary page", () => {
    setUrl("");
    expect(isDraftLayout()).toBe(false);
  });

  it("is off for a value nobody defined", () => {
    // A visitor typing one by hand gets the published site. The admin endpoint
    // behind this is permission-gated anyway, but the flag should not be a guess.
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=published`);
    expect(isDraftLayout()).toBe(false);
  });
});

describe("showing the editor's chrome", () => {
  it("is on ONLY for the editor's mode", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=draft`);
    expect(isLayoutPreview()).toBe(true);
  });

  /**
   * ⚠ THE regression this file exists for. A theme preview reads the draft and must
   * look like the site — no drop zones, no region labels, no selection bridge.
   */
  it("is OFF for the theme preview, which reads the same draft", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=preview`);
    expect(isDraftLayout()).toBe(true);
    expect(isLayoutPreview()).toBe(false);
  });

  it("is off on an ordinary page", () => {
    setUrl("");
    expect(isLayoutPreview()).toBe(false);
  });
});

/**
 * Which template the preview is EDITING — the third question, and the one that
 * decides where the surrounding chrome comes from.
 *
 * The preview used to draw every template from its draft, so the site header around
 * an article page was whatever was staged for `chrome.header`. A site whose header
 * draft predated its masthead previewed every page without the band, and the admin
 * read that as the site header having disappeared. Naming the edited template lets
 * everything else come from what is PUBLISHED, which is the question being asked:
 * how does this page look on the live site once I publish THIS template.
 */
describe("the template being edited", () => {
  it("is named by the editor's own preview", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=draft&${LAYOUT_EDITING_PARAM}=article.index`);
    expect(editingTemplate()).toBe("article.index");
  });

  it("is nobody on an ordinary page", () => {
    setUrl("");
    expect(editingTemplate()).toBeNull();
  });

  /**
   * ⚠ The theme preview shows the whole STAGED site, so it has no template under a
   * cursor to make an exception for — every document comes from the draft there.
   */
  it("is nobody in the theme preview, even if the param is present", () => {
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=preview&${LAYOUT_EDITING_PARAM}=home`);
    expect(editingTemplate()).toBeNull();
  });

  it("is nobody when the editor's mode is on but no template is named", () => {
    // An older link, or a hand-typed URL: fall back to the previous behaviour
    // (drafts everywhere) rather than silently previewing published layouts.
    setUrl(`?${LAYOUT_PREVIEW_PARAM}=draft`);
    expect(editingTemplate()).toBeNull();
  });
});

/**
 * The editor's presence, stamped on `<html>` for CSS to read.
 *
 * Two collapse rules are scoped by it: on the SITE a rail or a column whose blocks
 * all drew nothing takes no space, and in the EDITOR it must not — dropping a block
 * into the rail and watching the rail disappear is what a plugin block that draws
 * nothing for the admin looks like. The marker comes from the bridge because the
 * bridge is only ever installed in the preview.
 */
describe("the editor marker", () => {
  it("is stamped while the bridge is installed, and removed with it", async () => {
    const { installPreviewBridge } = await import("./previewBridge");
    expect(document.documentElement.dataset.xtEditor).toBeUndefined();
    const teardown = installPreviewBridge();
    expect(document.documentElement.dataset.xtEditor).toBe("1");
    teardown();
    expect(document.documentElement.dataset.xtEditor).toBeUndefined();
  });
});
