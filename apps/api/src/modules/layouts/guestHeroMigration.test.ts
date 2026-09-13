/**
 * The Guest Home carry-over.
 *
 * `Appearance → Guest Home` is gone and its hero strings are block props, so this runs
 * once on boot to move a customised hero into the home layout document. It is the only
 * part of that change that can LOSE an admin's work, which is what these assertions
 * are about: carry a customisation, never overwrite an existing arrangement, never
 * write anything on a site that had nothing to carry, and never run twice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_VARIANT, blockTypesIn, type BlockNode } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { GUEST_HERO_MIGRATED, migrateGuestHeroToLayout } from "./guestHeroMigration.js";

const CUSTOM_TITLE = "Welcome to the Widget Works forum";

async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({
    where: { key }, update: { value: value as object }, create: { key, value: value as object },
  });
  bustSettingsCache(key);
}

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.layout.deleteMany({});
  await prisma.setting.deleteMany({
    where: { key: { in: [GUEST_HERO_MIGRATED, "guesthome.hero_title", "guesthome.show_presence", "guesthome.show_tags"] } },
  });
  bustSettingsCache();
});

/** Every node in a stored document, flattened. */
function nodesOf(doc: unknown): BlockNode[] {
  const out: BlockNode[] = [];
  const walk = (nodes: BlockNode[]) => {
    for (const n of nodes) { out.push(n); if (n.children?.length) walk(n.children); }
  };
  for (const nodes of Object.values((doc as { regions: Record<string, BlockNode[]> }).regions)) walk(nodes);
  return out;
}

const storedHome = async () =>
  prisma.layout.findFirst({ where: { templateKey: "home", variant: DEFAULT_VARIANT } });

describe("nothing to carry", () => {
  it("writes no layout for a site that never touched the settings", async () => {
    // A fresh install must stay at zero stored layouts — the state the rest of the
    // system treats as "use the code default".
    expect((await migrateGuestHeroToLayout()).status).toBe("nothing-to-carry");
    expect(await storedHome()).toBeNull();
  });

  it("ignores a setting stored at the value the old page called default", async () => {
    await setSetting("guesthome.hero_title", "Where people who build with xentium hang out.");
    expect((await migrateGuestHeroToLayout()).status).toBe("nothing-to-carry");
    expect(await storedHome()).toBeNull();
  });

  it("still records completion, so it never reconsiders", async () => {
    await migrateGuestHeroToLayout();
    const flag = await prisma.setting.findUnique({ where: { key: GUEST_HERO_MIGRATED } });
    expect(flag?.value).toBe(true);
  });
});

describe("carrying a customised hero", () => {
  beforeEach(async () => { await setSetting("guesthome.hero_title", CUSTOM_TITLE); });

  it("writes a published home document", async () => {
    expect((await migrateGuestHeroToLayout()).status).toBe("carried");
    const row = await storedHome();
    expect(row?.scope).toBe("published");
  });

  it("puts the admin's title on the hero block as a plain string", async () => {
    // Plain, not an i18n reference: they typed it in one language, and a reference
    // would look up a key that does not exist.
    await migrateGuestHeroToLayout();
    const hero = nodesOf((await storedHome())!.document).find((n) => n.type === "guestHeroText");
    expect(hero?.props.title).toBe(CUSTOM_TITLE);
  });

  it("leaves the strings it did not customise as translatable references", async () => {
    await migrateGuestHeroToLayout();
    const hero = nodesOf((await storedHome())!.document).find((n) => n.type === "guestHeroText");
    // `badge` was never customised, so it keeps the shipped wording — which has to
    // stay an i18n reference or the site would be pinned to English.
    expect(hero?.props.badge).toEqual({ key: "guestHome.hero.badge", ns: "common" });
  });

  it("keeps the rest of the guest landing intact", async () => {
    await migrateGuestHeroToLayout();
    const types = blockTypesIn((await storedHome())!.document as never);
    for (const t of ["guestSurface", "guestHero", "guestHeroText", "guestFeed", "guestRail"]) {
      expect([...types], t).toContain(t);
    }
  });

  it("drops the presence block when the old toggle had it off", async () => {
    // The toggle became "is the block placed", so absence IS the setting.
    await setSetting("guesthome.show_presence", false);
    await migrateGuestHeroToLayout();
    expect([...blockTypesIn((await storedHome())!.document as never)]).not.toContain("guestPresence");
  });

  it("carries a section toggle onto the block that owns it", async () => {
    await setSetting("guesthome.show_tags", false);
    await migrateGuestHeroToLayout();
    const rail = nodesOf((await storedHome())!.document).find((n) => n.type === "guestRail");
    expect(rail?.props.showTags).toBe(false);
    expect(rail?.props.showOnline).toBe(true);
  });
});

describe("it never destroys existing work", () => {
  it("leaves an arrangement the admin already built alone", async () => {
    await setSetting("guesthome.hero_title", CUSTOM_TITLE);
    await prisma.layout.create({
      data: {
        templateKey: "home", variant: DEFAULT_VARIANT, scope: "published",
        document: { templateKey: "home", schemaVersion: 1, regions: { main: [{ id: "mine", type: "heading", props: {} }] } },
        schemaVersion: 1,
      },
    });

    expect((await migrateGuestHeroToLayout()).status).toBe("kept-existing-layout");
    const types = blockTypesIn((await storedHome())!.document as never);
    expect([...types]).toEqual(["heading"]);
  });

  it("is a no-op on the second run", async () => {
    await setSetting("guesthome.hero_title", CUSTOM_TITLE);
    expect((await migrateGuestHeroToLayout()).status).toBe("carried");
    expect((await migrateGuestHeroToLayout()).status).toBe("already-done");
    expect(await prisma.layout.count({ where: { templateKey: "home" } })).toBe(1);
  });
});
