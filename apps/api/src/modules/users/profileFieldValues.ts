/**
 * Server-side checks for profile field values, shared by every path that writes
 * them (registration, Account → Profile). The browser's inputs are hints, not
 * rules: anything can be posted.
 */
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Earliest date of birth we accept. */
export const DOB_MIN = "1900-01-01";

/** Every type a profile field can have. */
export const PROFILE_FIELD_TYPES = ["text", "longtext", "date", "email", "url", "choice"] as const;
export type ProfileFieldType = (typeof PROFILE_FIELD_TYPES)[number];

/** The longest answer each type takes when the field sets no `maxLength`. */
export const TYPE_MAX_LENGTH: Record<ProfileFieldType, number> = {
  text: 255, longtext: 2000, date: 10, email: 254, url: 500, choice: 80,
};

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

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC). */
export function ageOn(dob: string, now = new Date()): number {
  const d = parseIsoDate(dob)!;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < d.getUTCMonth()
    || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

/** A choice field's options, from its stored JSON. */
export function choiceOptions(options: unknown): string[] {
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isHttpUrl = (v: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

function invalid(label: string, why: string): never {
  throw new XentiumError({ code: "XEC-USER-4018", httpStatus: 422, message: `${label}: ${why}` });
}

/**
 * Refuse values their field does not allow. Empty values pass (they clear the
 * field); unknown field ids are left to the caller's own handling.
 *   - the date of birth: a real date after 1900 and before today (XEC-USER-4017),
 *     and at sign-up at least the field's minimum age (XEC-USER-4019)
 *   - any other date field: a real YYYY-MM-DD date (XEC-API-4001)
 *   - every other type: its length cap, and email / link / choice shape (XEC-USER-4018)
 *   - at sign-up, every field required there must be filled in (XEC-USER-4020)
 */
export async function assertProfileFieldValues(
  values: { fieldId: string; value: string }[],
  opts: { registration?: boolean; now?: Date } = {},
): Promise<void> {
  const filled = values.filter((v) => v.value.trim() !== "");
  if (opts.registration) {
    // The form marks required fields, but anything can be posted: a field the admin
    // made required at sign-up must arrive filled in (XEC-USER-4020).
    const required = await prisma.userProfileField.findMany({
      where: { showOnRegistration: true, requiredOnRegistration: true },
      select: { id: true, label: true },
    });
    const given = new Set(filled.map((v) => v.fieldId));
    const missing = required.find((f) => !given.has(f.id));
    if (missing) {
      throw new XentiumError({ code: "XEC-USER-4020", httpStatus: 422, message: `${missing.label} is required to sign up` });
    }
  }
  if (filled.length === 0) return;
  const fields = await prisma.userProfileField.findMany({
    where: { id: { in: filled.map((v) => v.fieldId) } },
    select: { id: true, key: true, label: true, type: true, maxLength: true, minAge: true, options: true },
  });
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const v of filled) {
    const f = byId.get(v.fieldId);
    if (!f) continue;
    const value = v.value.trim();
    const type = (PROFILE_FIELD_TYPES as readonly string[]).includes(f.type) ? (f.type as ProfileFieldType) : "text";

    if (type === "date") {
      if (f.key === "date_of_birth") {
        if (!isValidDob(value, opts.now)) {
          throw new XentiumError({
            code: "XEC-USER-4017", httpStatus: 422,
            message: "Date of birth must be a real date after 1900 and before today",
          });
        }
        if (opts.registration && f.minAge > 0 && ageOn(value, opts.now) < f.minAge) {
          throw new XentiumError({
            code: "XEC-USER-4019", httpStatus: 422,
            message: `You must be at least ${f.minAge} to sign up`,
          });
        }
      } else if (!parseIsoDate(value)) {
        throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "Invalid date" });
      }
      continue;
    }

    const max = f.maxLength ?? TYPE_MAX_LENGTH[type];
    if (value.length > max) invalid(f.label, `at most ${max} characters`);
    if (type === "email" && !isEmail(value)) invalid(f.label, "not an email address");
    if (type === "url" && !isHttpUrl(value)) invalid(f.label, "not a web address");
    if (type === "choice" && !choiceOptions(f.options).includes(value)) invalid(f.label, "not one of the options");
  }
}

/** Who sees an answer: what the member chose, else the field's default. */
export async function privacyFor(
  values: { fieldId: string; privacy?: string }[],
): Promise<Map<string, string>> {
  const missing = values.filter((v) => !v.privacy).map((v) => v.fieldId);
  const defaults = missing.length
    ? await prisma.userProfileField.findMany({ where: { id: { in: missing } }, select: { id: true, defaultPrivacy: true } })
    : [];
  const byId = new Map(defaults.map((d) => [d.id, d.defaultPrivacy]));
  return new Map(values.map((v) => [v.fieldId, v.privacy ?? byId.get(v.fieldId) ?? "public"]));
}
