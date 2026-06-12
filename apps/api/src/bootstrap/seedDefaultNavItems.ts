import { prisma } from "../infrastructure/db.js";

/** Core navigation links (§50). Seeded at install, ensured on every boot. */
const CORE_NAV_ITEMS = [
  { label: "Home",     url: "/",         position: 1 },
  { label: "Articles", url: "/articles", position: 2 },
  { label: "Members",  url: "/members",  position: 3 },
] as const;

/**
 * Idempotently ensure the core nav links exist. Core links are `isSystem`:
 * they cannot be deleted (only deactivated) and plugin links always append
 * below them. Safe to call repeatedly — existing items (matched by URL, so a
 * hand-created link is never duplicated) are left untouched, including any
 * admin customization of label, position, or active state.
 */
export async function seedDefaultNavItems(): Promise<void> {
  for (const item of CORE_NAV_ITEMS) {
    const existing = await prisma.navItem.findFirst({ where: { url: item.url } });
    if (!existing) {
      await prisma.navItem.create({ data: { ...item, isSystem: true } });
    }
  }
}
