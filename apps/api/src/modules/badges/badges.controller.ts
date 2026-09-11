import type { RequestHandler } from "express";
import { badgesService } from "./badges.service.js";
import { badgeCriteriaRegistry } from "../../core/badge-registry/badge-criteria-registry.js";

/** Core metrics are unnamespaced; a plugin's are `<plugin>.<metric>`. */
function pluginOf(key: string): string | null {
  const dot = key.indexOf(".");
  return dot === -1 ? null : key.slice(0, dot);
}
import {
  awardSchema, badgeIdParam, badgesForUsersQuery,
  createBadgeSchema, revokeParams, updateBadgeSchema,
} from "./badges.validation.js";

export const badgesController = {
  /**
   * What a badge can be earned FOR, right now.
   *
   * ⚠ Read from the live registry rather than a fixed list, so the forum's metrics
   * appear only while the forum is enabled — which is exactly what the admin was
   * promised. A threshold already stored against a disabled plugin stays in the
   * badge untouched; it simply is not offered or evaluated until the plugin returns.
   */
  metrics: (async (_req, res) => {
    res.json(badgeCriteriaRegistry.getAll().map((m) => ({
      key: m.key, label: m.label, plugin: pluginOf(m.key),
    })));
  }) as RequestHandler,

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
