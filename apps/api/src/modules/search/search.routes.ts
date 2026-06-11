import { Router } from "express";
import { z } from "zod";
import { searchService } from "./search.service.js";

export const searchRouter: Router = Router();

const querySchema = z.object({
  q:     z.string().min(1).max(200),
  // "all" | "articles" | "users" | any registered plugin source id (e.g. "forum")
  type:  z.string().max(40).default("all"),
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

searchRouter.get("/", async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query" });
    }
    const { q, type, page, limit } = parsed.data;
    const isLoggedIn = !!(req as any).userId;

    const results = await searchService.search({ query: q, type, isLoggedIn, page, limit });
    res.json(results);
  } catch (e) { next(e); }
});
