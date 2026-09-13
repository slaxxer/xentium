/**
 * Badge data for user cards, coalesced into one request per page.
 *
 * ⚠ THE POINT OF THIS FILE. A user card draws wherever a user is named — a forum
 * thread lists twenty of them — and a card that fetched its own badges would be
 * twenty requests for one page. Every `useUserBadges` in a render pass lands in the
 * same tick's batch, which goes out as a single `?ids=a,b,c`.
 *
 * ⚠ The batch is bounded at 100 by the endpoint, so a page asking for more is split
 * into several requests rather than being refused wholesale.
 *
 * The cache is TanStack Query's, keyed per user, so a second card for the same
 * person costs nothing and an award granted in the ACP invalidates one key.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AwardedBadge } from "@xentium/contracts";

const MAX_IDS_PER_REQUEST = 100;

let pending = new Set<string>();
let scheduled: Promise<Record<string, AwardedBadge[]>> | null = null;

function flush(): Promise<Record<string, AwardedBadge[]>> {
  const ids = [...pending];
  pending = new Set();
  scheduled = null;
  if (ids.length === 0) return Promise.resolve({});

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    chunks.push(ids.slice(i, i + MAX_IDS_PER_REQUEST));
  }

  return Promise.all(
    chunks.map((c) => api.get<Record<string, AwardedBadge[]>>(`/user-badges/batch?ids=${c.join(",")}`)),
  ).then((parts) => Object.assign({}, ...parts) as Record<string, AwardedBadge[]>);
}

/**
 * Join this tick's batch and resolve with one user's badges.
 *
 * ⚠ A microtask, not a timer. Everything React renders in one pass queues before
 * the microtask runs, so the batch is complete without holding the first card's
 * data back by a fixed delay.
 */
export function loadUserBadges(userId: string): Promise<AwardedBadge[]> {
  pending.add(userId);
  scheduled ??= Promise.resolve().then(flush);
  // Captured before the await: `scheduled` is null again by the time it settles.
  return scheduled.then((all) => all[userId] ?? []);
}

export function useUserBadges(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["user-badges", userId],
    queryFn:  () => loadUserBadges(userId!),
    enabled:  !!userId,
    // Badges change when an admin grants one, which is rare and not urgent. A long
    // window keeps a busy thread page from re-asking as cards scroll in and out.
    staleTime: 5 * 60_000,
  });
}

/** A badge as the public catalogue describes it — no holder data, no award. */
export interface CatalogueBadge {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  faIcon: string | null;
  color: string | null;
  displayOrder: number;
}

/**
 * Every badge this site recognises.
 *
 * ⚠ One query key for the whole app, and a long stale time: the catalogue is
 * site-wide, changes only when an admin edits it, and every profile rail asks for
 * it. Keyed separately from a user's own badges so granting an award invalidates
 * one user without re-fetching the catalogue.
 */
export function useBadgeCatalogue() {
  return useQuery({
    queryKey: ["badge-catalogue"],
    queryFn:  () => api.get<CatalogueBadge[]>("/user-badges/catalogue"),
    staleTime: 30 * 60_000,
  });
}
