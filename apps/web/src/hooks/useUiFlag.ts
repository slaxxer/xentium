/**
 * One per-person UI flag (`/users/me/ui-flags`): a tour seen, the layout editor's
 * Advanced mode. Remembered on the server, so it follows the admin across browsers.
 *
 * `on` is `undefined` while the flags load, so a caller can wait instead of acting
 * on a guess (a tour must not flash open for someone who has seen it).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const KEY = ["ui-flags"];

export function useUiFlag(flag: string): { on: boolean | undefined; set: (on: boolean) => void } {
  const qc = useQueryClient();
  const { data } = useQuery<{ flags: string[] }>({
    queryKey: KEY,
    queryFn: () => api.get("/users/me/ui-flags"),
    staleTime: Infinity,
  });
  const mut = useMutation({
    mutationFn: (on: boolean) => api.put<{ flags: string[] }>(`/users/me/ui-flags/${encodeURIComponent(flag)}`, { on }),
    // Optimistic: the switch answers at once, the server catches up.
    onMutate: (on) => {
      qc.setQueryData<{ flags: string[] }>(KEY, (old) => {
        const flags = (old?.flags ?? []).filter((f) => f !== flag);
        return { flags: on ? [...flags, flag] : flags };
      });
    },
    onSuccess: (res) => qc.setQueryData(KEY, res),
  });
  return { on: data ? data.flags.includes(flag) : undefined, set: (on) => mut.mutate(on) };
}
