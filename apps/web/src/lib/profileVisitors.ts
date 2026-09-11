/**
 * Who has looked at a profile lately.
 *
 * ⚠ Its OWN query rather than a field on the profile payload. The profile is read on
 * every tab change and every follow, and the visitor list is a side panel that
 * changes on a different clock — folding it in would refetch the whole card to move
 * one avatar, and would put a write-heavy table on the profile's critical path.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface ProfileVisitor {
  id:       string;
  username: string;
  avatar:   string | null;
  viewedAt: string;
}

export interface ProfileVisitorSummary {
  items:      ProfileVisitor[];
  visitors:   number;
  thisWeek:   number;
  totalViews: number;
  lastAt:     string | null;
}

export function useProfileVisitors(userId: string | null | undefined, limit: number) {
  return useQuery({
    queryKey: ["profile-visitors", userId, limit],
    queryFn:  () => api.get<ProfileVisitorSummary>(`/users/${userId}/visitors?limit=${limit}`),
    enabled:  !!userId,
    // Someone arriving while you read the page is not news worth a refetch.
    staleTime: 60_000,
  });
}
