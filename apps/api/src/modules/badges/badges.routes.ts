/**
 * Badge routes, in two halves.
 *
 * The ADMIN half is mounted under `/api/admin/badges` and split across two
 * permissions: `badge.manage` edits the CATALOGUE (what the site recognises at
 * all), `badge.assign` grants and revokes (a routine thing a moderator does to a
 * member). A site can hand out the second without handing over the first.
 *
 * The PUBLIC half is what user cards read. Unauthenticated on purpose: a badge is
 * an award on show, and the card that draws it is already public — a profile, an
 * article author card, a forum post. It exposes nothing the profile page does not.
 */
import { Router } from "express";
import { CorePermissions } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { badgesController } from "./badges.controller.js";

export const badgesAdminRouter: Router = Router();

const manage = requirePermission(CorePermissions.BADGE_MANAGE);
const assign = requirePermission(CorePermissions.BADGE_ASSIGN);

// ⚠ Before `/:id`, or "metrics" is read as a badge id.
badgesAdminRouter.get("/metrics", manage, badgesController.metrics);
badgesAdminRouter.get("/",     manage, badgesController.list);
badgesAdminRouter.post("/",    manage, badgesController.create);
badgesAdminRouter.patch("/:id",  manage, badgesController.update);
badgesAdminRouter.delete("/:id", manage, badgesController.remove);

badgesAdminRouter.get("/:id/holders", assign, badgesController.holders);
badgesAdminRouter.post("/:id/award",  assign, badgesController.award);
badgesAdminRouter.delete("/:id/award/:userId", assign, badgesController.revoke);

export const badgesPublicRouter: Router = Router();

// ⚠ Before `/:id`, or "batch" and "catalogue" are read as user ids.
badgesPublicRouter.get("/batch",     badgesController.forUsers);
badgesPublicRouter.get("/catalogue", badgesController.catalogue);
badgesPublicRouter.get("/:id",   badgesController.forUser);
