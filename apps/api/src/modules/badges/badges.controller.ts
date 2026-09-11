import type { RequestHandler } from "express";
import { badgesService } from "./badges.service.js";
import {
  awardSchema, badgeIdParam, badgesForUsersQuery,
  createBadgeSchema, revokeParams, updateBadgeSchema,
} from "./badges.validation.js";

export const badgesController = {
  list: (async (_req, res) => {
    res.json(await badgesService.list());
  }) as RequestHandler,

  create: (async (req, res) => {
    const body = createBadgeSchema.parse(req.body);
    res.status(201).json(await badgesService.create(body));
  }) as RequestHandler,

  update: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    const body = updateBadgeSchema.parse(req.body);
    res.json(await badgesService.update(id, body));
  }) as RequestHandler,

  remove: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    await badgesService.remove(id);
    res.status(204).end();
  }) as RequestHandler,

  uploadIcon: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    const file = req.file!;
    // `detectedExt` is the magic-byte-derived extension, not whatever the browser
    // claimed — the same rule every other upload route follows.
    const url = await badgesService.uploadIcon(id, file.buffer, `x.${file.detectedExt ?? "png"}`);
    res.json({ icon: url });
  }) as RequestHandler,

  removeIcon: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    res.json(await badgesService.removeIcon(id));
  }) as RequestHandler,

  holders: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    res.json(await badgesService.holders(id));
  }) as RequestHandler,

  award: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    const { userId, note } = awardSchema.parse(req.body);
    res.json(await badgesService.award(userId, id, req.userId!, note));
  }) as RequestHandler,

  revoke: (async (req, res) => {
    const { id, userId } = revokeParams.parse(req.params);
    res.json(await badgesService.revoke(userId, id));
  }) as RequestHandler,

  /** Every badge this site recognises. Public — see `publicCatalogue`. */
  catalogue: (async (_req, res) => {
    res.json(await badgesService.publicCatalogue());
  }) as RequestHandler,

  /** Every badge one user holds. Public — a badge is on show by design. */
  forUser: (async (req, res) => {
    const { id } = badgeIdParam.parse(req.params);
    res.json(await badgesService.forUser(id));
  }) as RequestHandler,

  /** The batch a page of user cards asks for. */
  forUsers: (async (req, res) => {
    const { ids } = badgesForUsersQuery.parse(req.query);
    res.json(await badgesService.forUsers(ids));
  }) as RequestHandler,
};
