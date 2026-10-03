import { useSyncExternalStore } from "react";

/**
 * Group key → rank image URL, for groups that have one WHILE the site shows rank
 * images (ACP → Settings → Rank display). The server only sends a URL in that mode,
 * so an empty map simply means "draw the text badges". Filled from the same
 * GET /members/groups the username glow reads (see BadgeShadowSync in App).
 */
let images = new Map<string, string>();
const listeners = new Set<() => void>();

export function setRankImages(groups: Array<{ key: string; rankImage?: string | null }>): void {
  const next = new Map<string, string>();
  for (const g of groups) if (g.rankImage) next.set(g.key, g.rankImage);
  images = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const getSnapshot = () => images;

/** Every group's rank image, by group key — for a surface that lays images out itself. */
export function useRankImages(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The rank image for a group, or null when the badge should be drawn. */
export function useRankImage(groupKey: string | null | undefined): string | null {
  const map = useRankImages();
  return groupKey ? map.get(groupKey) ?? null : null;
}
