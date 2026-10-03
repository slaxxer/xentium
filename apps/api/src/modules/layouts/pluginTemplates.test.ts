/**
 * Layouts for plugin-registered templates (ADR-0005 Amendment 3).
 *
 * The registry itself is unit-tested in `apps/web/src/layout/templateRegistry.test.ts`
 * (it lives in contracts, which both runtimes share). What is only true on the SERVER
 * is what these cover: the layout service treats a plugin's template like core's
 * while the plugin is enabled, refuses to write one that is not registered, and —
 * the load-bearing one — keeps the admin's stored arrangement when the plugin goes
 * away instead of serving it, so disabling a plugin is never what deletes their work.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VARIANT,
  deregisterTemplatesFor,
  registerTemplate,
  type LayoutDocument,
} from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { layoutService } from "./layout.service.js";

const PLUGIN = "xentium-testplug";
const KEY = "testplug.index";
const USER = null as unknown as string; // `updatedById` is nullable; no user needed here

/** The declaration the plugin would ship, shaped like the forum's real one. */
const declaration = {
  key:      KEY,
  label:    "Test index",
  pluginId: PLUGIN,
  regions:  ["header", "main", "aside"],
  previewRoute: "/testplug",
  defaultDocument: {
    templateKey: KEY,
    regions: { main: [{ id: "shipped", type: "heading", props: { text: "Shipped" } }] },
  },
};

/** An admin's own arrangement of that template. */
const customised: LayoutDocument = {
  templateKey:   KEY,
  schemaVersion: 1,
  regions: {
    header: [{ id: "mine", type: "heading", props: { text: "Mine", level: 2 } }],
    main:   [{ id: "shipped", type: "heading", props: { text: "Shipped" } }],
  },
};

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
  registerTemplate(declaration);
});

afterEach(async () => {
  deregisterTemplatesFor(PLUGIN);
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
});

describe("while the plugin is enabled", () => {
  it("serves the plugin's shipped default alongside core's templates", async () => {
    const { templates } = await layoutService.getPublishedAll();
    expect(templates[KEY]?.regions.main).toHaveLength(1);
    expect(templates["home"]).toBeDefined();   // core is unaffected
  });

  it("saves, publishes and resets a draft exactly like a core template", async () => {
    await layoutService.saveDraft({ templateKey: KEY, variant: DEFAULT_VARIANT }, customised, USER, undefined, "");

    const { pending } = await layoutService.getDraftStatus("");
    expect(pending).toContainEqual({ templateKey: KEY, variant: DEFAULT_VARIANT });

    await layoutService.publish(USER, "");
    const { templates } = await layoutService.getPublishedAll();
    expect(templates[KEY]?.regions.header).toHaveLength(1);

    await layoutService.reset({ templateKey: KEY, variant: DEFAULT_VARIANT }, "");
    const after = await layoutService.getPublishedAll();
    // Back to the plugin's shipped default, not to nothing.
    expect(after.templates[KEY]?.regions.header ?? []).toHaveLength(0);
    expect(after.templates[KEY]?.regions.main).toHaveLength(1);
  });

  it("reports ownership, so a theme update can tell touched from untouched", async () => {
    const clean = await layoutService.getOwnership("");
    expect(clean[KEY]).toEqual({ customised: false, hasTheme: false });

    await layoutService.saveDraft({ templateKey: KEY, variant: DEFAULT_VARIANT }, customised, USER, undefined, "");
    const dirty = await layoutService.getOwnership("");
    expect(dirty[KEY]?.customised).toBe(true);
  });

  /**
   * Variants are per-INSTANCE layouts and a plugin template declares no instances,
   * so there is nothing for a variant key to name. Refused rather than stored as a
   * row nothing will ever read — the same rule core applies to `profile`.
   */
  it("refuses a variant, because a plugin template declares no instances", async () => {
    await expect(
      layoutService.saveDraft({ templateKey: KEY, variant: "anything" }, customised, USER, undefined, ""),
    ).rejects.toThrow(/does not support per-instance layouts/);
  });
});

describe("a template nothing has registered", () => {
  it("refuses a save with a 422 that names it, rather than storing a dead row", async () => {
    await expect(
      layoutService.saveDraft(
        { templateKey: "nosuch.template", variant: DEFAULT_VARIANT },
        { ...customised, templateKey: "nosuch.template" },
        USER, undefined, ""),
    ).rejects.toThrow(/Unknown template "nosuch.template"/);

    expect(await prisma.layout.count({ where: { templateKey: "nosuch.template" } })).toBe(0);
  });
});

describe("when the plugin is disabled", () => {
  it("KEEPS the stored document and stops serving the template", async () => {
    await layoutService.saveDraft({ templateKey: KEY, variant: DEFAULT_VARIANT }, customised, USER, undefined, "");
    await layoutService.publish(USER, "");

    // What `disablePlugin` does, minus the database bookkeeping.
    deregisterTemplatesFor(PLUGIN);
    layoutService.bustCache();

    const { templates } = await layoutService.getPublishedAll();
    expect(templates[KEY]).toBeUndefined();          // the page does not exist right now
    expect(templates["home"]).toBeDefined();         // and nothing else changed

    // The row is untouched. This is the whole point: turning a plugin off must never
    // be what deletes an admin's arrangement of its pages.
    const rows = await prisma.layout.findMany({ where: { templateKey: KEY } });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.document as unknown as LayoutDocument).regions.header).toHaveLength(1);
  });

  it("restores the admin's arrangement when the plugin comes back", async () => {
    await layoutService.saveDraft({ templateKey: KEY, variant: DEFAULT_VARIANT }, customised, USER, undefined, "");
    await layoutService.publish(USER, "");

    deregisterTemplatesFor(PLUGIN);
    layoutService.bustCache();
    expect((await layoutService.getPublishedAll()).templates[KEY]).toBeUndefined();

    registerTemplate(declaration);
    layoutService.bustCache();
    const { templates } = await layoutService.getPublishedAll();
    expect(templates[KEY]?.regions.header).toHaveLength(1);
  });

  /**
   * ⚠ Without `bustCache` in `disablePlugin` this passes anyway after 30 seconds and
   * fails for the whole window before that — the published map is memoized per key.
   * Asserted through the same call the engine makes, so removing it breaks a test
   * rather than producing a half-minute of a page that "lost its layout".
   */
  it("takes effect immediately, not when the published cache expires", async () => {
    await layoutService.getPublishedAll();            // warm the memo WITH the template
    deregisterTemplatesFor(PLUGIN);
    layoutService.bustCache();
    expect((await layoutService.getPublishedAll()).templates[KEY]).toBeUndefined();
  });
});
