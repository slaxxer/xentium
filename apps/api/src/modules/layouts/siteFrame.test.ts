/**
 * The site frame, stored beside the layouts it frames.
 *
 * Driven against the database rather than a mock: the frame's whole design is that it
 * rides the layout table's draft → publish, theme baseline and concurrency rules, and
 * a mock would only prove that the calls were made.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_FRAME,
  SITE_FRAME_ROW_KEY,
  siteFrameSchema,
  type SiteFrame,
} from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { layoutService, bustThemeLayouts } from "./layout.service.js";
import { bustThemeCss } from "../appearance/appearance.service.js";

const USER = null as unknown as string; // `updatedById` is nullable

/** A frame that is NOT the default (the default is full width). */
const framed = (patch: Record<string, unknown> = {}): SiteFrame =>
  siteFrameSchema.parse({ mode: "framed", ...patch });

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { httpStatus?: number };
  }
};

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
});

afterEach(async () => {
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
});

describe("site frame", () => {
  it("is the default (full width) on a site that never set one, everywhere it is served", async () => {
    expect((await layoutService.getPublishedAll()).frame).toEqual(DEFAULT_SITE_FRAME);
    expect((await layoutService.getDraftAll("")).frame).toEqual(DEFAULT_SITE_FRAME);
    expect((await layoutService.getFrameDraft("")).frame).toEqual(DEFAULT_SITE_FRAME);
    expect((await layoutService.getDraftStatus("")).pending).toEqual([]);
  });

  it("stages a draft the preview sees and visitors do not, until Publish", async () => {
    await layoutService.saveFrameDraft(framed(), USER, undefined, "");

    expect((await layoutService.getDraftAll("")).frame.mode).toBe("framed");
    expect((await layoutService.getPublishedAll()).frame.mode).toBe("full");
    expect((await layoutService.getDraftStatus("")).pending)
      .toContainEqual({ templateKey: SITE_FRAME_ROW_KEY, variant: "" });

    const { published } = await layoutService.publish(USER, "");
    expect(published).toContainEqual({ templateKey: SITE_FRAME_ROW_KEY, variant: "" });
    expect((await layoutService.getPublishedAll()).frame.mode).toBe("framed");
    expect((await layoutService.getDraftStatus("")).pending).toEqual([]);
  });

  it("stores exactly the frame — nothing of the row leaks into the document", async () => {
    await layoutService.saveFrameDraft(framed(), USER, undefined, "");
    await layoutService.publish(USER, "");
    const row = await prisma.layout.findUnique({
      where: { themeKey_templateKey_variant_scope: { themeKey: "", templateKey: SITE_FRAME_ROW_KEY, variant: "", scope: "published" } },
    });
    expect(row?.document).toEqual(framed());
  });

  it("a draft equal to what is live is not pending", async () => {
    await layoutService.saveFrameDraft(DEFAULT_SITE_FRAME, USER, undefined, "");
    expect((await layoutService.getDraftStatus("")).pending).toEqual([]);
  });

  it("refuses a frame outside the editor's ranges, and an unknown page override", async () => {
    expect((await errorOf(layoutService.saveFrameDraft({ mode: "boxed", maxWidth: 5000 }, USER, undefined, "")))?.httpStatus).toBe(422);
    expect((await errorOf(layoutService.saveFrameDraft({ overrides: { "chrome.header": "boxed" } }, USER, undefined, "")))?.httpStatus).toBe(422);
    expect((await errorOf(layoutService.saveFrameDraft({ background: { stops: ["red; x: y"] } }, USER, undefined, "")))?.httpStatus).toBe(422);
  });

  it("refuses a save built on a revision someone else has moved past", async () => {
    const first = await layoutService.saveFrameDraft(framed(), USER, null, "");
    await layoutService.saveFrameDraft(framed({ radius: 4 }), USER, first.version, "");
    const stale = await errorOf(layoutService.saveFrameDraft(framed({ radius: 30 }), USER, first.version, ""));
    expect(stale?.httpStatus).toBe(409);
    expect((await layoutService.getFrameDraft("")).frame.radius).toBe(4);
  });

  it("is invisible to everything that reads layouts: no template, no variant", async () => {
    await layoutService.saveFrameDraft(framed(), USER, undefined, "");
    await layoutService.publish(USER, "");
    const all = await layoutService.getPublishedAll();
    expect(Object.keys(all.templates)).not.toContain(SITE_FRAME_ROW_KEY);
    expect(all.variants).toEqual({});
    expect(Object.keys(await layoutService.getOwnership(""))).not.toContain(SITE_FRAME_ROW_KEY);
  });

  describe("per theme", () => {
    const T = "frame-theme";
    const install = async (frame: SiteFrame | null) => {
      await prisma.theme.upsert({
        where:  { id: T },
        update: { payload: { documents: {}, tokens: null, customCss: null, frame } as object },
        create: {
          id: T, name: "Frame theme", version: "1.0.0", vendor: "test", manifest: { id: T },
          payload: { documents: {}, tokens: null, customCss: null, frame } as object,
        },
      });
      bustThemeLayouts(T);
      bustThemeCss(T);
    };
    afterEach(async () => { await prisma.theme.deleteMany({ where: { id: T } }); bustThemeCss(T); bustThemeLayouts(T); });

    it("serves what the theme ships until someone edits it", async () => {
      await install(framed({ mode: "floating" }));
      expect((await layoutService.getPublishedFor(T)).frame.mode).toBe("floating");
      // Core is untouched by the theme's frame.
      expect((await layoutService.getPublishedFor("")).frame.mode).toBe("full");
    });

    it("reverts to the theme's frame as a draft, or to full width for Core", async () => {
      await install(framed({ mode: "floating" }));
      await layoutService.saveFrameDraft(framed({ radius: 2 }), USER, undefined, T);
      const reverted = await layoutService.revertFrameToTheme(USER, T);
      expect(reverted.frame.mode).toBe("floating");
      expect(reverted.theme?.mode).toBe("floating");
      expect(reverted.themeName).toEqual({ name: "Frame theme", version: "1.0.0" });
      expect((await layoutService.revertFrameToTheme(USER, "")).frame).toEqual(DEFAULT_SITE_FRAME);
    });

    it("knows a customised frame from one still at its baseline", async () => {
      await install(framed());
      expect(await layoutService.isFrameCustomised(T)).toBe(false);
      await layoutService.saveFrameDraft(framed({ maxWidth: 1000 }), USER, undefined, T);
      expect(await layoutService.isFrameCustomised(T)).toBe(true);
    });

    it("an update releases an untouched frame to the new version and keeps an edited one", async () => {
      await install(framed());
      await layoutService.saveFrameDraft(framed(), USER, undefined, T); // equal to what ships
      expect((await layoutService.releaseUntouched(T)).frameKept).toBe(false);
      await install(framed({ mode: "overlap" }));
      expect((await layoutService.getFrameDraft(T)).frame.mode).toBe("overlap");

      await layoutService.saveFrameDraft(framed({ radius: 3 }), USER, undefined, T);
      expect((await layoutService.releaseUntouched(T)).frameKept).toBe(true);
    });

    it("rides the theme's undo snapshot", async () => {
      await install(null);
      await layoutService.saveFrameDraft(framed(), USER, undefined, T);
      const snapshot = await layoutService.snapshotTheme(T);
      await layoutService.saveFrameDraft(framed({ mode: "overlap" }), USER, undefined, T);
      await layoutService.restoreTheme(snapshot, USER, T);
      expect((await layoutService.getFrameDraft(T)).frame.mode).toBe("framed");
    });
  });
});
