/**
 * The product was renamed Nodevo → Xentium, and the official plugins were
 * renamed with it (`nodevo-forum` → `xentium-forum`). A plugin id is also a
 * PRODUCT id: it is what an entitlement's claims name and what the paid-id
 * cache lists.
 *
 * So for a window, both names mean the same product. An install that renames
 * its plugins before the marketplace has renamed its catalogue would otherwise
 * fail its own licence check — the plugin is owned, the claim just spells it
 * the old way — and the enable gate would refuse a plugin the admin paid for.
 *
 * One direction only: a NEW id also answers to its OLD one. Nothing here makes
 * an old id valid on its own, and a third-party plugin whose author happens to
 * use a `nodevo-` prefix is untouched — the map is explicit.
 *
 * Delete this once no install and no catalogue still carries the old ids.
 */
const LEGACY_PRODUCT_ID: Readonly<Record<string, string>> = {
  "xentium-forum":               "nodevo-forum",
  "xentium-messaging":           "nodevo-messaging",
  "xentium-shoutbox":            "nodevo-shoutbox",
  "xentium-advanced-moderation": "nodevo-advanced-moderation",
  "xentium-launch":              "nodevo-launch",
};

/** The id itself, plus its pre-rename spelling when it has one. */
export function productIdAliases(productId: string): string[] {
  const legacy = LEGACY_PRODUCT_ID[productId];
  return legacy ? [productId, legacy] : [productId];
}
