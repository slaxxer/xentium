// Well-known page slots (§page-system). A slot maps to at most one page, stored
// in settings as `pages.slot.<slot> = pageId`. Footer renders all assigned slots;
// registration renders an "I agree to <terms>" checkbox when `terms` is assigned.
export const PAGE_SLOTS = ["terms", "privacy", "imprint", "guidelines"] as const;

export type PageSlot = (typeof PAGE_SLOTS)[number];

/** Setting key holding the page id assigned to a slot. */
export function pageSlotSettingKey(slot: PageSlot): string {
  return `pages.slot.${slot}`;
}
