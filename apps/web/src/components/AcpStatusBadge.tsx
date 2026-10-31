import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useAcpBadgeCounts } from "../features/admin/nav/acpBadges";

interface StatusSummary {
  pluginUpdates:       number;
  coreUpdate:          boolean;
  criticalUpdate:      boolean;
  announcement:        boolean;
  licenseExpiringSoon: boolean;
  licenseExpired:      boolean;
  total:               number;
  urgent:              boolean;
}

/**
 * A red dot on the frontend navbar ACP (gear) icon — "something is waiting in
 * the admin panel" for admins browsing the site. Deliberately no number: the
 * dot says to look, the ACP says what. It stays until the work is done (plugin
 * updates until applied, a new Xentium until the site runs it, the license while
 * it's about to expire / has expired, a Xentium announcement until an admin
 * reads it or it expires). Server-aggregated (GET
 * /admin/status-summary) so this stays a dumb consumer. Add-ons count too: any
 * ACP badge a plugin registers (`registerAcpBadge`, e.g. orders waiting for a
 * payment check) lights the same dot. Renders nothing when there's nothing to
 * show. Only mounted for admins.
 */
export function AcpStatusBadge() {
  const { t } = useTranslation("common");
  const { data } = useQuery<StatusSummary>({
    queryKey:  ["acp-status-summary"],
    queryFn:   () => api.get("/admin/status-summary"),
    staleTime: 5 * 60_000,
  });

  const addons = useAcpBadgeCounts();

  if ((data?.total ?? 0) <= 0 && addons.size === 0) return null;
  return <span className="pub-nav__dot" role="status" aria-label={t("nav.adminAttention")} />;
}
