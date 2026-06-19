import { Router } from "express";
import { z } from "zod";
import { userService } from "../users/users.service.js";
import { prisma } from "../../infrastructure/db.js";
import { requireFeature } from "../../shared/middleware/requireFeature.js";

export const membersRouter: Router = Router();

// Public group legend — every user group (name + badge color), ordered by badge
// precedence. Used by the site footer so the legend shows all groups, not just
// those currently online. Guests are excluded (anonymous, no member color).
membersRouter.get("/groups", async (_req, res, next) => {
  try {
    const groups = await prisma.group.findMany({
      where: { key: { not: "guest" } },
      orderBy: { displayOrder: "asc" },
      select: {
        name: true,
        key: true,
        progression: { select: { badgeColor: true, badgeLabel: true } },
      },
    });
    res.json(
      groups.map((g) => ({
        name: g.name,
        key: g.key,
        badgeColor: g.progression?.badgeColor ?? null,
        badgeLabel: g.progression?.badgeLabel ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

const listSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().min(1).max(60).default(24),
  q:      z.string().trim().max(60).optional(),
  filter: z.string().trim().max(40).optional(),
  sort:   z.enum(["active", "followers", "newest", "az"]).optional(),
});

// Public members directory.
membersRouter.get("/team", async (_req, res, next) => {
  try {
    res.json(await userService.listTeam());
  } catch (err) {
    next(err);
  }
});

membersRouter.get("/hall-of-fame", async (_req, res, next) => {
  try {
    res.json(await userService.getHallOfFame(24));
  } catch (err) {
    next(err);
  }
});

// Directory list is gated by the `members` feature. Shared sub-endpoints above
// (/groups for the footer legend, /team, /hall-of-fame) stay public.
membersRouter.get("/", requireFeature("members"), async (req, res, next) => {
  try {
    const { page, limit, q, filter, sort } = listSchema.parse(req.query);
    res.json(await userService.listMembers({ page, limit, q, filter, sort }));
  } catch (err) {
    next(err);
  }
});
