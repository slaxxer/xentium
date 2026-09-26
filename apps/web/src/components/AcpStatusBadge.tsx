import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface StatusSummary {
  pluginUpdates:       number;
  coreUpdate:          boolean;
  criticalUpdate:      boolean;
  licenseExpiringSoon: boolean;
  licenseExpired:      boolean;
  total:               number;
  urgent:              boolean;
}

/**
 * Small count badge on the frontend navbar ACP (gear) icon — a standing "there's
 * something waiting in the admin panel" signal for admins browsing the site.
 * Persists until the work is done (plugin updates until applied, a new Xentium
 * until the site runs it, the license while it's about to expire / has expired).
 * Red when urgent, neutral otherwise.
 * Server-aggregated (GET /admin/status-summary) so this stays a dumb consumer.
 * Renders nothing when there's nothing to show. Only mounted for admins.
 */
export function AcpStatusBadge() {
  const { data } = useQuery<StatusSummary>({
    queryKey:  ["acp-status-summary"],
    queryFn:   () => api.get("/admin/status-summary"),
    staleTime: 5 * 60_000,
  });

  const total = data?.total ?? 0;
  if (total <= 0) return null;

  return (
    <span aria-hidden="true" className={`pub-nav__badge${data?.urgent ? " pub-nav__badge--urgent" : ""}`}>
      {total > 99 ? "99+" : total}
    </span>
  );
}
