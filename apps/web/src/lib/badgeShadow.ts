import { useSyncExternalStore } from "react";

/**
 * App-wide map of badge colour → assembled CSS `text-shadow` for groups that have
 * the username "glow" enabled (ACP → Progression → Badge). The Username component
 * consults this so a glowing name renders consistently everywhere — core and
 * plugins — without threading a per-group config through every endpoint and call
 * site. Populated once at boot from GET /members/groups (see App).
 *
 * Keyed by lowercased *badge* colour (the colour the name is rendered in). The glow
 * itself is independently configurable — colour (null = the badge colour) plus X/Y
 * /blur offsets. Two groups sharing a badge colour is rare and this is purely
 * cosmetic, so a colour → shadow lookup is good enough (last one wins).
 */
export interface GroupShadowConfig {
  badgeColor:       string | null;
  badgeTextShadow?: boolean;
  badgeShadowColor?: string | null;
  badgeShadowX?:    number;
  badgeShadowY?:    number;
  badgeShadowBlur?: number;
}

let shadows = new Map<string, string>();
const listeners = new Set<() => void>();

export function setBadgeShadows(groups: GroupShadowConfig[]): void {
  const next = new Map<string, string>();
  for (const g of groups) {
    if (!g.badgeTextShadow || !g.badgeColor) continue;
    const x = g.badgeShadowX ?? 1;
    const y = g.badgeShadowY ?? 1;
    const blur = g.badgeShadowBlur ?? 20;
    const color = g.badgeShadowColor || g.badgeColor;
    next.set(g.badgeColor.toLowerCase(), `${x}px ${y}px ${blur}px ${color}`);
  }
  shadows = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getSnapshot(): Map<string, string> {
  return shadows;
}

/** Reactive accessor — re-renders subscribers when the map is (re)populated. */
export function useBadgeShadows(): Map<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
