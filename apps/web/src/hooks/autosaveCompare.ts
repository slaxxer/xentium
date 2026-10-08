/**
 * Draft-vs-saved comparison for ACP forms, shared by `useDraft` (the save bar) and
 * `useDebouncedSave` (drafts that still autosave).
 */
/**
 * JSON with object keys in a stable order.
 *
 * Draft-vs-saved is a deep comparison done by serialising both sides, and the
 * saved side has usually been through Postgres `jsonb` — which stores an
 * object's keys in its own order (shortest first, then bytewise), not the order
 * we wrote them. `JSON.stringify` therefore reports `{icon,label,url}` and
 * `{url,icon,label}` as different drafts, and since saving cannot make the two
 * strings agree, the form saves, refetches, disagrees again, and saves forever.
 * One click on "Add link" in ACP → Settings was measured at 84 PUTs.
 *
 * Sorting keys makes both sides agree. Key order is never meaningful in a
 * settings draft, so this only ever removes saves that should not have fired.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    // Returning a re-keyed object is enough: stringify then walks THIS object,
    // so nested values are sorted on their own visit.
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** True when two drafts hold the same data, whatever order their keys are in. */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
