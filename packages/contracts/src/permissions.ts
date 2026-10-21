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

  // Badges (ADR-0009). Two keys, not one: granting a badge is a routine thing a
  // moderator does to a member, while editing the catalogue changes what the site
  // recognises at all — a site can hand out the first without handing over the second.
  BADGE_MANAGE: "badge.manage",
  BADGE_ASSIGN: "badge.assign",

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
  // Staff moderation on an article: close its comments (and still comment there), hide it.
  ARTICLE_COMMENTS_CLOSE: "article.comments.close",
  ARTICLE_COMMENT_CLOSED: "article.comment.closed",
  ARTICLE_HIDE: "article.hide",

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
  // Who counts as STAFF: cannot be warned or banned, is skipped by a case's
  // "Ban all", is exempt where a sign-in guard exempts staff, and is listed under
  // the members page's Staff filter. A permission, not a list of group names, so a
  // site that adds its own team group decides in ACP → Permissions.
  MODERATION_PROTECTED:      "moderation.protected",
  // A warning counts for as long as its template says, and a ban lasts as long as its
  // template says. These let a team lead (Supermod by default) set another length
  // when they issue one. Moderators follow the template.
  MODERATION_WARN_EXPIRY_OVERRIDE: "moderation.warn.expiry.override",
  MODERATION_BAN_LENGTH_OVERRIDE:  "moderation.ban.length.override",

  // Profile comments (§40)
  PROFILE_COMMENT_CREATE:      "profile.comment.create",
  PROFILE_COMMENT_DELETE_OWN:  "profile.comment.delete.own",
  PROFILE_COMMENT_DELETE_WALL: "profile.comment.delete.wall",
  PROFILE_COMMENT_DELETE_ANY:  "profile.comment.delete.any",

  // Legal documents — terms, privacy, disclaimer, imprint. Admin-only by default:
  // the text is the operator's legal statement.
  LEGAL_MANAGE: "legal.manage",

  // Custom emojis the editor offers (ACP → Content → Emojis). Admin-only by default.
  EMOJI_MANAGE: "emoji.manage",

  // Plugins
  PLUGIN_INSTALL: "plugin.install",
  PLUGIN_ENABLE: "plugin.enable",

  // Scheduled tasks — admin-created recurring jobs. Separate from admin.access
  // on purpose: a task runs unattended and some actions are destructive, so it
  // can be withheld from admins who should not automate that.
  SYSTEM_TASKS_MANAGE: "system.tasks.manage",

  // One-click core updates from the ACP. The update itself runs on the server
  // (the updater), but starting one replaces the code the site runs, so it is
  // its own key: an admin can manage the site without being allowed to update it.
  SYSTEM_UPDATE: "system.update",
} as const;

export type PermissionKey =
  (typeof CorePermissions)[keyof typeof CorePermissions];

/**
 * Keys that carry others with them: whoever may edit anyone's article may edit
 * their own. Only the key an admin granted is stored; every check expands through
 * this map (`expandImplied`), and the ACP shows the carried key as held but
 * locked — revoking it would change nothing while the stronger key stays.
 */
export const PERMISSION_IMPLIES: Readonly<Record<string, readonly string[]>> = {
  "article.edit.any":           ["article.edit.own"],
  "article.delete.any":         ["article.delete.own"],
  "article.comment.delete.any": ["article.comment.delete.own"],
  "article.revisions.restore":  ["article.revisions.view"],
  "moderation.warn.expiry.override": ["moderation.warn.manage"],
  "moderation.ban.length.override":  ["moderation.ban.manage"],
};

/** `keys` plus everything they imply, without duplicates. */
export function expandImplied(keys: Iterable<string>): string[] {
  const out = new Set(keys);
  for (const k of [...out]) for (const implied of PERMISSION_IMPLIES[k] ?? []) out.add(implied);
  return [...out];
}

/** The keys whose holder also holds `key` (never `key` itself). */
export function impliersOf(key: string): string[] {
  return Object.keys(PERMISSION_IMPLIES).filter((k) => PERMISSION_IMPLIES[k]!.includes(key));
}
