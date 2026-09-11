/**
 * Which block an icon is being drawn inside, and which occurrence it is.
 *
 * This is what makes a SINGLE icon in the live preview addressable: not "every
 * heart on the site" but "the second `heart` in this block". The key is
 * `"<icon-name>#<n>"`, stored on the block itself (`BlockNode.iconOverrides`), so an
 * override travels with the block and publishes with the layout draft.
 *
 * ⚠ The counter is created FRESH for each render of a block and consumed during that
 * same render pass. Counting during render is normally a smell, but the state never
 * outlives the pass that made it: React's double-invoked render in StrictMode builds
 * a new counter each time, so the nth icon is the nth icon either way. The
 * alternative — threading an explicit slot id through all 373 call sites, core and
 * plugin — is the thing this avoids.
 *
 * ⚠ Scoped per NAME, deliberately. Numbering every icon in a block from zero would
 * mean adding an unrelated icon at the top renumbered everything below it and every
 * override slid onto a different icon. Per-name, adding a `gear` cannot disturb the
 * `chevron-down`s.
 *
 * ⚠ Order is RENDER order, which for a synchronous tree is DOM order. A block that
 * suspends mid-render could in principle interleave; nothing in core does, and the
 * failure mode is an override drawing on a sibling rather than anything breaking.
 */
import { createContext, useContext, useRef } from "react";

export interface IconSlotScope {
  /** The block these icons belong to. */
  blockId:   string;
  /** Name → how many have been drawn so far in this pass. Mutated during render. */
  counters:  Map<string, number>;
  /** `"<name>#<n>"` → icon token. */
  overrides: Record<string, string> | undefined;
}

const Ctx = createContext<IconSlotScope | null>(null);

/**
 * ⚠ The counter is created ONCE per block and kept, not rebuilt each render. Slots
 * are claimed at mount, so a rebuilt counter would give the next icon to mount an
 * index another icon already holds.
 */
export function IconSlotProvider(
  { blockId, overrides, children }:
  { blockId: string; overrides: Record<string, string> | undefined; children: React.ReactNode },
) {
  const counters = useRef<Map<string, number>>(undefined as never);
  if (!counters.current) counters.current = new Map();
  // A new object each render so consumers re-read `overrides`; the Map inside is the
  // stable one, which is the only part that must not be rebuilt.
  return (
    <Ctx.Provider value={{ blockId, counters: counters.current, overrides }}>
      {children}
    </Ctx.Provider>
  );
}

/**
 * Claim this component's slot, ONCE, for the life of the icon.
 *
 * ⚠ A ref, not a bare counter read. The naive version counted during render and was
 * wrong the moment React rendered twice: StrictMode double-invokes every component,
 * so the first icon claimed 0 and then 1, and the key written to the document in
 * development was not the key production would compute. That is the worst kind of
 * bug — invisible locally in the direction that matters.
 *
 * A ref is the fix because it is the same object across both invocations of a mount:
 * the first claims, the second sees the claim and reuses it. It also makes the slot
 * stable for the component's whole life, so a block re-rendering for any other reason
 * cannot renumber icons underneath an override that is already stored.
 *
 * ⚠ The COUNTER must therefore outlive the render too — see `IconSlotProvider`. A
 * fresh counter per render would hand a newly mounted icon index 0, colliding with
 * the icon that already holds it.
 */
export function useIconSlot(
  scope: IconSlotScope | null, name: string | null,
): { key: string; override: string | undefined } | null {
  const claimed = useRef<{ key: string } | null | undefined>(undefined);
  if (claimed.current === undefined) {
    if (!scope || !name) {
      claimed.current = null;
    } else {
      const n = scope.counters.get(name) ?? 0;
      scope.counters.set(name, n + 1);
      claimed.current = { key: `${name}#${n}` };
    }
  }
  const key = claimed.current?.key;
  if (!key) return null;
  // ⚠ The override is read FRESH every render, never cached with the key — editing
  // one in the rail has to repaint the preview immediately.
  return { key, override: scope?.overrides?.[key] };
}

export function useIconSlotScope(): IconSlotScope | null {
  return useContext(Ctx);
}
