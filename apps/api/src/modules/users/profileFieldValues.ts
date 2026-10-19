/**
 * Server-side checks for profile field values, shared by every path that writes
 * them (registration, Account → Profile). The browser's date picker is a hint,
 * not a rule: anything can be posted.
 */
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Earliest date of birth we accept. */
export const DOB_MIN = "1900-01-01";

/** A real calendar date in YYYY-MM-DD ("2023-02-30" is not), as UTC midnight. */
export function parseIsoDate(value: string): Date | null {
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? d : null;
}

/** A date of birth must be a real date after 1900-01-01 and before today. */
export function isValidDob(value: string, now = new Date()): boolean {
  const d = parseIsoDate(value);
  if (!d) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return d.getTime() > Date.parse(`${DOB_MIN}T00:00:00Z`) && d.getTime() < today;
}

/**
 * Refuse values their field's type does not allow. Empty values pass (they clear
 * the field); unknown field ids are left to the caller's own handling.
 *   - the date of birth: a real date after 1900 and before today (XEC-USER-4017)
 *   - any other date field: a real YYYY-MM-DD date (XEC-API-4001)
 */
export async function assertProfileFieldValues(values: { fieldId: string; value: string }[]): Promise<void> {
  const filled = values.filter((v) => v.value.trim() !== "");
  if (filled.length === 0) return;
  const fields = await prisma.userProfileField.findMany({
    where: { id: { in: filled.map((v) => v.fieldId) } },
    select: { id: true, key: true, type: true },
  });
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const v of filled) {
    const f = byId.get(v.fieldId);
    if (!f || f.type !== "date") continue;
    if (f.key === "date_of_birth") {
      if (!isValidDob(v.value)) {
        throw new XentiumError({
          code: "XEC-USER-4017", httpStatus: 422,
          message: "Date of birth must be a real date after 1900 and before today",
        });
      }
    } else if (!parseIsoDate(v.value)) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "Invalid date" });
    }
  }
}
