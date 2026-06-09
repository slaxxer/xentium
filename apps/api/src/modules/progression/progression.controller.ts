import type { RequestHandler } from "express";
import { z } from "zod";
import { progressionService } from "./progression.service.js";
import {
  updateGroupProgressionSchema,
  globalProgressionSettingsSchema,
} from "./progression.validation.js";

const groupIdParam = (req: Express.Request) => (req as any).params.id as string;

export const progressionController = {
  // ── Group-level ────────────────────────────────────────────────────────────

  getGroupProgression: (async (req, res) => {
    res.json(await progressionService.getGroupProgression(groupIdParam(req)));
  }) as RequestHandler,

  updateGroupProgression: (async (req, res) => {
    const data = updateGroupProgressionSchema.parse(req.body);
    res.json(await progressionService.updateGroupProgression(groupIdParam(req), data));
  }) as RequestHandler,

  // ── Global ladder ──────────────────────────────────────────────────────────

  getLadder: (async (_req, res) => {
    res.json(await progressionService.getLadder());
  }) as RequestHandler,

  getAllGroupsWithProgression: (async (_req, res) => {
    res.json(await progressionService.getAllGroupsWithProgression());
  }) as RequestHandler,

  updateGlobalSettings: (async (req, res) => {
    const data = globalProgressionSettingsSchema.parse(req.body);
    res.json(await progressionService.updateGlobalSettings(data));
  }) as RequestHandler,

  // ── Ladder reorder ─────────────────────────────────────────────────────────

  reorderLadder: (async (req, res) => {
    const { items } = z.object({
      items: z.array(z.object({
        groupId:       z.string(),
        ladderPosition: z.number().int().positive(),
      })),
    }).parse(req.body);
    await progressionService.reorderLadder(items);
    res.status(204).end();
  }) as RequestHandler,

  // ── User limits ────────────────────────────────────────────────────────────

  getMyLimits: (async (req, res) => {
    const userId = (req as any).userId as string;
    res.json(await progressionService.getUserLimits(userId));
  }) as RequestHandler,

  getMyProgression: (async (req, res) => {
    const userId = (req as any).userId as string;
    res.json(await progressionService.getUserProgression(userId));
  }) as RequestHandler,
};
