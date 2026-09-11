import { z } from "zod";
import { parseIconToken } from "@nodevo/contracts";

/** A hex colour, or nothing. Same shape the group badge colour accepts. */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Expected a hex colour").nullable();

/**
 * An ICON TOKEN — `"star"`, or `"jelly-regular:star"` to pin a style.
 *
 * ⚠ Was an enum of the 48 curated names. It is deliberately open now: a site with a
 * FontAwesome kit can draw far more than core bundles, and refusing those at the
 * door would make the kit useless exactly where an admin most wants it. What is NOT
 * open is the shape — `parseIconToken` closes the charset, because this string ends
 * up in a class attribute.
 *
 * ⚠ Legacy `"faStar"` still validates and is stored as written. The reader
 * normalises it, so badges created before tokens existed need no migration.
 */
const faIconSchema = z.string()
  .refine((v) => parseIconToken(v) !== null, "Not a valid icon")
  .nullable();

export const badgeIdParam = z.object({ id: z.string().min(1) });

/**
 * The thresholds, keyed by metric.
 *
 * ⚠ Keys are NOT validated against the registry. A plugin that is temporarily
 * disabled must not make its thresholds unsaveable — and an admin editing a badge's
 * name would then be blocked by a key they never touched. The registry decides what
 * COUNTS at sweep time; this only decides what is storable.
 */
const criteriaSchema = z.record(
  z.string().min(1).max(60),
  z.number().int().min(0).max(1_000_000),
);

export const createBadgeSchema = z.object({
  key:          z.string().regex(/^[a-z0-9_-]+$/, "Lowercase letters, digits, - and _ only").min(2).max(40),
  name:         z.string().min(2).max(60),
  description:  z.string().max(300).nullable().optional(),
  faIcon:       faIconSchema.optional(),
  color:        colorSchema.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  autoAward:    z.boolean().optional(),
  criteria:     criteriaSchema.optional(),
});

/** The key is absent on purpose — it is the stable identifier seeds and plugins
 *  use, so renaming a badge changes its NAME and never what it is called by. */
export const updateBadgeSchema = z.object({
  name:         z.string().min(2).max(60).optional(),
  description:  z.string().max(300).nullable().optional(),
  faIcon:       faIconSchema.optional(),
  color:        colorSchema.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  autoAward:    z.boolean().optional(),
  criteria:     criteriaSchema.optional(),
});

export const awardSchema = z.object({
  userId: z.string().min(1),
  note:   z.string().max(200).nullable().optional(),
});

export const revokeParams = z.object({ id: z.string().min(1), userId: z.string().min(1) });

/**
 * The batch read every user card uses.
 *
 * ⚠ Bounded at 100 ids. A page of cards is a page, and an unbounded `in` clause on
 * a public endpoint is a way to ask the database for the whole table.
 */
export const badgesForUsersQuery = z.object({
  ids: z.string().min(1).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
        .refine((ids) => ids.length <= 100, "At most 100 ids per request"),
});
