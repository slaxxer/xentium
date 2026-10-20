import type { RequestHandler } from "express";
import { legalService } from "./legal.service.js";
import { acceptanceSchema, askAgainSchema, legalKeyParamSchema, saveDraftSchema } from "./legal.validation.js";

export const legalController = {
  // Public
  listPublished: (async (_req, res) => {
    res.json(await legalService.listPublished());
  }),

  getPublished: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    res.json(await legalService.getPublished(key));
  }),

  // Admin
  listAll: (async (_req, res) => {
    res.json(await legalService.listAll());
  }),

  saveDraft: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    const { draftBody } = saveDraftSchema.parse(req.body);
    await legalService.saveDraft(key, draftBody, req.userId!);
    res.status(204).send();
  }),

  publish: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    await legalService.publish(key, req.userId!);
    res.status(204).send();
  }),

  unpublish: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    await legalService.unpublish(key, req.userId!);
    res.status(204).send();
  }),

  discardDraft: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    await legalService.discardDraft(key, req.userId!);
    res.status(204).send();
  }),
  setAcceptance: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    const { requireAcceptance } = acceptanceSchema.parse(req.body);
    await legalService.setRequireAcceptance(key, requireAcceptance, req.userId!);
    res.status(204).send();
  }),

  askAgain: (async (req, res) => {
    const { key } = legalKeyParamSchema.parse(req.params);
    const { groupIds } = askAgainSchema.parse(req.body);
    await legalService.askAgain(key, groupIds, req.userId!);
    res.status(204).send();
  }),
} satisfies Record<string, RequestHandler>;
