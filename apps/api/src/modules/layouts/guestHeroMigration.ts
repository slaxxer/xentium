/**
 * One-time carry-over of `Appearance → Guest Home` into the home layout (ADR-0005).
 *
 * The guest landing's hero copy and section toggles used to be settings
 * (`guesthome.*`) edited by a dedicated ACP page. They are block props now, which
 * makes that page redundant — but an admin who customised their hero must not lose it
 * on upgrade. So on first boot after this change the settings are read and written
 * into a published `home` document as the props of `guestHeroText`, `guestFeed` and
 * `guestRail`.
 *
 * Three properties that matter:
 *
 *  - **Idempotent.** A flag setting records completion, so a restart is a no-op. Not
 *    "does a home layout exist?" — an admin might legitimately have one already.
 *  - **Non-destructive.** It refuses to touch an existing `home` document. A site that
 *    has already arranged its home page keeps that arrangement; the flag is set anyway
 *    so this never runs again.
 *  - **Silent when there is nothing to carry.** A site that never edited the settings
 *    has nothing to preserve — the shipped defaults already say the same thing — so the
 *    flag is set and no row is written. A fresh install therefore stays at zero stored
 *    layouts, which is the state everything else assumes.
 */
import {
  DEFAULT_LAYOUTS,
  DEFAULT_VARIANT,
  type BlockNode,
  type LayoutDocument,
} from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSettings } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const GUEST_HERO_MIGRATED = "layout.guestHeroMigrated";

/** Writes the completion flag. Bust the cache, per the settings contract. */
async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: GUEST_HERO_MIGRATED },
    update: { value: true },
    create: { key: GUEST_HERO_MIGRATED, value: true },
  });
  bustSettingsCache(GUEST_HERO_MIGRATED);
}

/** The settings the old ACP page wrote, with the values it treated as defaults. */
const LEGACY_DEFAULTS = {
  "guesthome.hero_badge":      "builders online now",
  "guesthome.hero_title":      "Where people who build with nodevo hang out.",
  "guesthome.hero_subtitle":   "Ask questions, show what you made, shape the roadmap, and learn from {members} makers. Reading is open to everyone.",
  "guesthome.cta_primary":     "Join the conversation",
  "guesthome.cta_secondary":   "Browse as guest",
  "guesthome.show_stats":      true,
  "guesthome.show_presence":   true,
  "guesthome.show_categories": true,
  "guesthome.show_online":     true,
  "guesthome.show_tags":       true,
} as const;

type LegacyKey = keyof typeof LEGACY_DEFAULTS;

/** Walk a document's tree and hand every node to `fn`, in place. */
function visit(nodes: BlockNode[], fn: (node: BlockNode) => void): void {
  for (const node of nodes) {
    fn(node);
    if (node.children?.length) visit(node.children, fn);
  }
}

export async function migrateGuestHeroToLayout(): Promise<
  { status: "already-done" | "nothing-to-carry" | "kept-existing-layout" | "carried" }
> {
  // `getSettings` is a batch read keyed by `{ key: default }`; `undefined` as the
  // default is how "absent" stays distinguishable from "stored and equal to default".
  const settings = await getSettings({
    [GUEST_HERO_MIGRATED]: false as unknown,
    ...Object.fromEntries(Object.keys(LEGACY_DEFAULTS).map((k) => [k, undefined as unknown])),
  } as Record<string, unknown>);

  if (settings[GUEST_HERO_MIGRATED]) return { status: "already-done" };

  // Only values that actually differ from what the old page called default are worth
  // carrying — everything else is already what the shipped document says.
  const customised = (Object.keys(LEGACY_DEFAULTS) as LegacyKey[]).filter((key) => {
    const stored = settings[key];
    return stored !== undefined && stored !== null && stored !== LEGACY_DEFAULTS[key];
  });

  if (customised.length === 0) {
    await markDone();
    return { status: "nothing-to-carry" };
  }

  // Never overwrite an arrangement an admin already built.
  const existing = await prisma.layout.findFirst({
    where: { templateKey: "home", variant: DEFAULT_VARIANT },
    select: { id: true },
  });
  if (existing) {
    logger.warn(
      { customised },
      "Guest Home settings were customised but a home layout already exists — " +
      "leaving it alone. Re-apply the hero text in Appearance → Layout Editor.",
    );
    await markDone();
    return { status: "kept-existing-layout" };
  }

  const custom = new Set<string>(customised);

  /**
   * Overwrite a prop ONLY where the admin actually customised the setting.
   *
   * The obvious version — read every setting, falling back to the legacy default —
   * pins the untouched strings to English, because those defaults are literal English
   * and the shipped document holds i18n references. So a German site that had only
   * changed its title would silently lose the translated badge and buttons.
   */
  const carry = (props: Record<string, unknown>, map: Record<string, LegacyKey>) => {
    const out = { ...props };
    for (const [prop, key] of Object.entries(map)) {
      if (custom.has(key)) out[prop] = settings[key];
    }
    return out;
  };

  const doc: LayoutDocument = structuredClone(DEFAULT_LAYOUTS.home);
  let heroFound = false;

  for (const nodes of Object.values(doc.regions)) {
    visit(nodes, (node) => {
      if (node.type === "guestHeroText") {
        heroFound = true;
        node.props = carry(node.props, {
          badge:        "guesthome.hero_badge",
          title:        "guesthome.hero_title",
          subtitle:     "guesthome.hero_subtitle",
          ctaPrimary:   "guesthome.cta_primary",
          ctaSecondary: "guesthome.cta_secondary",
          showStats:    "guesthome.show_stats",
        });
      }
      if (node.type === "guestFeed") {
        node.props = carry(node.props, { showCategories: "guesthome.show_categories" });
      }
      if (node.type === "guestRail") {
        node.props = carry(node.props, {
          showCategories: "guesthome.show_categories",
          showOnline:     "guesthome.show_online",
          showTags:       "guesthome.show_tags",
        });
      }
    });
  }

  // `show_presence: false` used to hide the panel; with blocks, absence IS the toggle.
  if (settings["guesthome.show_presence"] === false) {
    for (const nodes of Object.values(doc.regions)) {
      visit(nodes, (node) => {
        if (node.children) node.children = node.children.filter((c) => c.type !== "guestPresence");
      });
    }
  }

  if (!heroFound) {
    // The shipped document no longer places the hero — nothing to carry it into.
    await markDone();
    return { status: "nothing-to-carry" };
  }

  await prisma.layout.create({
    data: {
      templateKey: "home",
      variant: DEFAULT_VARIANT,
      scope: "published",
      document: doc as object,
      schemaVersion: doc.schemaVersion,
    },
  });
  await markDone();

  logger.info(
    { customised },
    "Carried the Guest Home hero settings into the home layout; " +
    "Appearance → Layout Editor now owns them.",
  );
  return { status: "carried" };
}
