import type { RequestHandler } from "express";
import { z } from "zod";
import { dashboardService } from "./dashboard.service.js";

const overviewSchema = z.object({
  range: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
});

export const dashboardController = {
  overview: (async (req, res) => {
    const { range } = overviewSchema.parse(req.query);
    res.json(await dashboardService.overview(range));
  }) as RequestHandler,
  setup: (async (_req, res) => {
    res.json(await dashboardService.setup());
  }) as RequestHandler,
};
