import { Router } from "express";
import { z } from "zod";
import { userService } from "../users/users.service.js";

export const membersRouter: Router = Router();

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

membersRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit, q, filter, sort } = listSchema.parse(req.query);
    res.json(await userService.listMembers({ page, limit, q, filter, sort }));
  } catch (err) {
    next(err);
  }
});
