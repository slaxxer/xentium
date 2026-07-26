/**
 * Core scheduled actions. Importing this module registers them — the runner and
 * the ACP API both import it so the registry is populated in whichever process
 * they run in.
 *
 * Actions are CORE-ONLY by design: a plugin owns its own cron jobs end to end,
 * so no task can ever point at a handler that disappears with a plugin.
 */
import "./recomputeCounters.js";
import "./purgeOrphanedUploads.js";
import "./purgeDeletedContent.js";
import "./trimArticleRevisions.js";
import "./pruneNotifications.js";

export { getAction, listActions, type ScheduledActionDef } from "./action-registry.js";
