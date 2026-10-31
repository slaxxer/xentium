import { useQueries } from "@tanstack/react-query";
import { slotRegistry } from "../../../plugins/slotRegistry";
import type { NavItem } from "../useAcpNav";

/**
 * The counts plugins put beside their ACP pages (`registerAcpBadge`), keyed by page
 * path. One query per badge, shared by the panel and the rail, polled every minute;
 * a badge that fails counts as nothing rather than breaking the menu.
 */
export function useAcpBadgeCounts(): Map<string, number> {
  const badges = slotRegistry.getAcpBadges();
  const results = useQueries({
    queries: badges.map((b) => ({
      queryKey: ["acp-badge", b.id],
      queryFn: () => b.count().catch(() => 0),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const counts = new Map<string, number>();
  badges.forEach((b, i) => {
    const n = results[i]?.data ?? 0;
    if (n > 0) counts.set(b.path, (counts.get(b.path) ?? 0) + n);
  });
  return counts;
}

/** Whether any page of a section has a count: its rail icon gets a dot. */
export const sectionHasBadge = (item: NavItem, counts: Map<string, number>) =>
  (item.children ?? []).some((c) => (counts.get(c.to) ?? 0) > 0) || (!!item.to && (counts.get(item.to) ?? 0) > 0);
