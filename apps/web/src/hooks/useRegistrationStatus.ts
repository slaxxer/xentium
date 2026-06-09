import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface RegistrationStatus {
  open:           boolean;
  mode:           string;
  inviteRequired: boolean;
  betaMode:       boolean;
}

export function useRegistrationStatus() {
  const { data } = useQuery<RegistrationStatus>({
    queryKey: ["registration-status"],
    queryFn:  () => api.get("/auth/registration-status"),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? { open: true, mode: "open", inviteRequired: false, betaMode: false };
}
