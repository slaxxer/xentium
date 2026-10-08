import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** The site's logo and wordmark, as the header and the sign-in pages draw them. */
export function useBranding() {
  return useQuery<{ navbarUrl: string | null; iconUrl: string | null; logoText: string | null }>({
    queryKey: ["pub-branding"],
    queryFn:  () => api.get("/appearance/branding"),
    staleTime: 300_000, // 5 min — branding rarely changes
  });
}
