import { useEffect, useState } from "react";

/**
 * Plugin slots that ask whether they belong (`shownFor`): a profile tab on a member
 * who publishes nothing, a "Licences" link for someone who never bought anything.
 * Each one asks once per user; until it answers it counts as NOT shown, so an entry
 * never appears and then vanishes. A failed answer counts as no.
 *
 * Returns whether a slot is shown, and whether it is still waiting for its answer.
 */
export function useShownFor<S extends { id: string; shownFor?: (userId: string) => Promise<boolean> }>(
  slots: S[], userId: string | null | undefined,
): { shown: (slot: S) => boolean; pending: (slot: S) => boolean } {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const asking = slots.filter((s) => s.shownFor).map((s) => s.id).join("|");

  useEffect(() => {
    setAnswers({});
    if (!userId) return;
    let live = true;
    for (const s of slots) {
      if (!s.shownFor) continue;
      s.shownFor(userId)
        .then((yes) => { if (live) setAnswers((prev) => ({ ...prev, [s.id]: yes })); })
        .catch(() => { if (live) setAnswers((prev) => ({ ...prev, [s.id]: false })); });
    }
    return () => { live = false; };
    // `asking` stands for the slot list: the registry hands out a new array each render.
  }, [userId, asking]);

  return {
    shown: (s) => !s.shownFor || answers[s.id] === true,
    pending: (s) => !!s.shownFor && !!userId && !(s.id in answers),
  };
}
