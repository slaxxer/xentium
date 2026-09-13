import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

const KEY = ["acp-setting", "plugins.allow_upload"] as const;

/**
 * Whether manual .xtplugin uploads are enabled (`plugins.allow_upload`, default
 * off). Drives the Upload nav item, the Upload page guard, and the toggle on the
 * Installed page. Shared query key so all three stay in sync.
 */
export function useUploadAllowed() {
  return useQuery({
    queryKey:  KEY,
    queryFn:   () => api.get<{ key: string; value: boolean | null }>("/admin/settings/plugins.allow_upload").then((r) => r.value === true),
    staleTime: 60_000,
  });
}

export const UPLOAD_ALLOWED_KEY = KEY;
