import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faCloudArrowDown, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";

interface PluginUpdate {
  pluginId:         string;
  name?:            string;
  installedVersion?: string | null;
  latestVersion:    string;
  critical:         boolean;
  renewalRequired:  boolean;
}

/**
 * Persistent update reminder shown on every Extensions-section page. Unlike the
 * one-shot ACP-entry dialog, this banner stays visible for as long as updates are
 * pending — the admin can't miss a critical patch by dismissing the dialog. It
 * links to the dedicated Updates page (hides itself there to avoid redundancy).
 */
export function ExtensionsUpdateBanner() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const location = useLocation();

  const { data } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  const updates = data?.updates ?? [];
  if (!updates.length || location.pathname === "/admin/updates") return null;

  const critical = updates.some((u) => u.critical);
  const accent   = critical ? "var(--c-danger)" : "var(--c-update, var(--c-accent))";

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/updates")}
      style={{
        width: "100%", textAlign: "left", cursor: "pointer",
        background: `color-mix(in srgb, ${accent} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`,
        borderRadius: "var(--radius-md)", padding: "12px 18px", marginBottom: 20,
        display: "flex", alignItems: "center", gap: 12, color: accent,
      }}
    >
      <FontAwesomeIcon icon={critical ? faTriangleExclamation : faCloudArrowDown} style={{ fontSize: 16 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--c-fg)" }}>
        {critical
          ? t("updates.bannerCritical", { count: updates.length })
          : t("updates.banner", { count: updates.length })}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>{t("updates.bannerAction")}</span>
    </button>
  );
}
