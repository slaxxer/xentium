/**
 * Bounds for a date-of-birth input, matching the server's rule
 * (apps/api/src/modules/users/profileFieldValues.ts): after 1900, before today.
 * The max is YESTERDAY in UTC, the latest date the server accepts wherever the
 * member is.
 */
export const DOB_MIN = "1900-01-02";

export function dobMax(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

