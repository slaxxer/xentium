import { z } from "zod";
import { BADGE_ICON_NAMES } from "@nodevo/contracts";

/** A hex colour, or nothing. Same shape the group badge colour accepts. */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Expected a hex colour").nullable();

/**
 * ⚠ One of the CURATED names, not any FontAwesome string.
 *
 * The frontend maps exactly these to icon definitions with explicit imports, so a
 * name outside the list renders as a silent gap on every card that draws the badge.
 * Refused at the door instead.
 */
const faIconSchema = z.enum(BADGE_ICON_NAMES).nullable();

export const badgeIdParam = z.object({ id: z.string().min(1) });

export const createBadgeSchema = z.object({
  key:          z.string().regex(/^[a-z0-9_-]+$/, "Lowercase letters, digits, - and _ only").min(2).max(40),
  name:         z.string().min(2).max(60),
  description:  z.string().max(300).nullable().optional(),
  faIcon:       faIconSchema.optional(),
  color:        colorSchema.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

/** The key is absent on purpose — it is the stable identifier seeds and plugins
 *  use, so renaming a badge changes its NAME and never what it is called by. */
export const updateBadgeSchema = z.object({
  name:         z.string().min(2).max(60).optional(),
  description:  z.string().max(300).nullable().optional(),
  faIcon:       faIconSchema.optional(),
  color:        colorSchema.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
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
