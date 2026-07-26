export const CorePermissions = {
  // Admin
  ADMIN_ACCESS:   "admin.access",
  ADMIN_PLUGINS:  "admin.plugins",

  // User management
  USER_MANAGE: "user.manage",
  USER_BAN: "user.ban",

  // Group / permission management
  GROUP_MANAGE: "group.manage",

  // Progression system (§38)
  PROGRESSION_MANAGE: "progression.manage",

  // Articles (§33, §46, §47)
  ARTICLE_CREATE: "article.create",
  ARTICLE_EDIT_OWN: "article.edit.own",
  ARTICLE_EDIT_ANY: "article.edit.any",
  ARTICLE_PUBLISH: "article.publish",
  ARTICLE_DELETE_OWN: "article.delete.own",
  ARTICLE_DELETE_ANY: "article.delete.any",
  ARTICLE_COMMENT_CREATE: "article.comment.create",
  ARTICLE_COMMENT_EDIT_OWN: "article.comment.edit.own",
  ARTICLE_COMMENT_DELETE_OWN: "article.comment.delete.own",
  ARTICLE_COMMENT_DELETE_ANY: "article.comment.delete.any",
  ARTICLE_REVISIONS_VIEW: "article.revisions.view",
  ARTICLE_REVISIONS_RESTORE: "article.revisions.restore",

  // Messaging (placeholder — owned by official messaging plugin post-v1)
  MESSAGE_SEND: "message.send",

  // Moderation (§12, §10)
  MODERATION_REPORT_FILE:    "moderation.report.file",
  MODERATION_REPORT_MANAGE:  "moderation.report.manage",
  MODERATION_WARN_MANAGE:    "moderation.warn.manage",
  MODERATION_BAN_MANAGE:     "moderation.ban.manage",
  MODERATION_CASES_MANAGE:   "moderation.cases.manage",
  MODERATION_LOG_VIEW:       "moderation.log.view",
  MODERATION_SETTINGS:       "moderation.settings",

  // Profile comments (§40)
  PROFILE_COMMENT_CREATE:      "profile.comment.create",
  PROFILE_COMMENT_DELETE_OWN:  "profile.comment.delete.own",
  PROFILE_COMMENT_DELETE_WALL: "profile.comment.delete.wall",
  PROFILE_COMMENT_DELETE_ANY:  "profile.comment.delete.any",

  // Pages (§page-system — custom static pages: TOS, privacy, imprint, …)
  PAGE_MANAGE:  "page.manage",
  PAGE_PUBLISH: "page.publish",

  // Plugins
  PLUGIN_INSTALL: "plugin.install",
  PLUGIN_ENABLE: "plugin.enable",

  // Scheduled tasks — admin-created recurring jobs. Separate from admin.access
  // on purpose: a task runs unattended and some actions are destructive, so it
  // can be withheld from admins who should not automate that.
  SYSTEM_TASKS_MANAGE: "system.tasks.manage",
} as const;

export type PermissionKey =
  (typeof CorePermissions)[keyof typeof CorePermissions];
