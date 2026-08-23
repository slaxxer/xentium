import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface RegistrationStatus {
  open:           boolean;
  mode:           string;
  inviteRequired: boolean;
  /** Set by whatever auth guard closed registration, so the wording belongs to
   *  the feature enforcing the policy rather than to core. */
  closedTitle?:   string;
  closedBody?:    string;
}

export function useRegistrationStatus() {
  const { data } = useQuery<RegistrationStatus>({
    queryKey: ["registration-status"],
    queryFn:  () => api.get("/auth/registration-status"),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? { open: true, mode: "open", inviteRequired: false };
}
