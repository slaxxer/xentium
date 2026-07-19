import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface StatusSummary {
  pluginUpdates:       number;
  criticalUpdate:      boolean;
  licenseExpiringSoon: boolean;
  licenseExpired:      boolean;
  total:               number;
  urgent:              boolean;
}

/**
 * Small count badge on the frontend navbar ACP (gear) icon — a standing "there's
 * something waiting in the admin panel" signal for admins browsing the site.
 * Persists until the work is done (plugin updates until applied, the license
 * while it's about to expire / has expired). Red when urgent, neutral otherwise.
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
    <span
      aria-hidden="true"
      style={{
        position: "absolute", top: -4, right: -4,
        background: data?.urgent ? "var(--c-danger)" : "var(--c-accent2)",
        color: "#fff", fontSize: 9, fontWeight: 800,
        minWidth: 16, height: 16, borderRadius: 99,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 3px", lineHeight: 1,
        border: "2px solid var(--c-card)",
      }}
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
