import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * An add-on's PUBLIC settings in its own pages: the keys it marked
 * `.meta({ public: true })`. Host global `webPluginSettings.usePublic(pluginId)`.
 * Admin-only settings never reach the browser this way; the add-on's own endpoints
 * read them on the server (`host.settings.get()`).
 */
export function usePublicPluginSettings<T extends Record<string, unknown> = Record<string, unknown>>(pluginId: string) {
  return useQuery<T>({
    queryKey: ["addon-public-settings", pluginId],
    queryFn: () => api.get(`/addons/${pluginId}/settings`),
    staleTime: 60_000,
  });
}
