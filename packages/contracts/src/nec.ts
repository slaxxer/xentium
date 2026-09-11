// NEC = Nodevo Error Code. Format: NEC-<DOMAIN>-<NNNN>.
// Shared across backend + frontend so error-handling UI can render localized
// messages keyed off these codes (§14).

export const NEC = {
  // API
  API_VALIDATION: "NEC-API-4001",
  API_FORBIDDEN: "NEC-API-4003",
  API_NOT_FOUND: "NEC-API-4004",
  API_CONFLICT: "NEC-API-4009",
  API_RATE_LIMIT: "NEC-API-4290",
  API_INTERNAL: "NEC-API-5000",

  // Auth
  AUTH_INVALID_CREDENTIALS: "NEC-AUTH-1001",
  AUTH_SESSION_EXPIRED: "NEC-AUTH-1002",
  AUTH_BANNED: "NEC-AUTH-1003",
  AUTH_BANNED_PERMANENT: "NEC-AUTH-1004",
  AUTH_EMAIL_UNVERIFIED: "NEC-AUTH-1005",
  AUTH_PASSWORD_POLICY: "NEC-AUTH-1006",
  AUTH_EMAIL_TAKEN: "NEC-AUTH-2001",
  AUTH_USERNAME_TAKEN: "NEC-AUTH-2002",
  AUTH_EMAIL_CODE_INVALID: "NEC-AUTH-2003",
  AUTH_RESET_TOKEN_INVALID: "NEC-AUTH-1007",
  AUTH_UNAUTHENTICATED: "NEC-AUTH-1008",   // protected route hit without a Bearer token
  AUTH_TOKEN_INVALID: "NEC-AUTH-1009",     // access token failed verification / expired
  AUTH_NO_SESSION: "NEC-AUTH-1010",        // refresh attempted without a session cookie
  AUTH_INVITE_REQUIRED: "NEC-AUTH-1020",
  AUTH_INVITE_INVALID: "NEC-AUTH-1021",
  AUTH_BETA_REQUIRED: "NEC-AUTH-1030",
  AUTH_BETA_CODE_INVALID: "NEC-AUTH-1031",
  AUTH_BETA_IP_LOCKED: "NEC-AUTH-1032",
  AUTH_LOCKED_OUT: "NEC-AUTH-1040",        // failed-login lockout (429) — details carry username/ip
  AUTH_NAME_REQUIRED: "NEC-AUTH-2004",
  AUTH_REGISTRATION_CLOSED: "NEC-AUTH-2010",

  // Permissions / RBAC
  PERM_DENIED: "NEC-PERM-1001",
  PERM_CONTENT_TOO_LONG: "NEC-PERM-1040",
  PERM_DAILY_LIMIT: "NEC-PERM-1041",
  PERM_ATTACHMENT_LIMIT: "NEC-PERM-1042",

  // Articles
  ARTICLE_NOT_FOUND: "NEC-ARTICLE-3001",
  ARTICLE_NOT_PUBLISHED: "NEC-ARTICLE-3002",
  ARTICLE_SLUG_TAKEN: "NEC-ARTICLE-3003",

  // Pages (§page-system)
  PAGE_NOT_FOUND: "NEC-PAGE-3501",
  PAGE_SLUG_TAKEN: "NEC-PAGE-3502",

  // Storage / Uploads
  STORE_FILE_TOO_LARGE: "NEC-STORE-7001",
  STORE_TYPE_NOT_PERMITTED: "NEC-STORE-7002",
  STORE_MIME_MISMATCH: "NEC-STORE-7003",
  STORE_PATH_FORBIDDEN: "NEC-STORE-7004",
  /** The image is larger than the surface it is for allows. Dimensions, not bytes —
   *  7001 already answers "too big to store", and a 32x32 badge slot refuses a
   *  perfectly small 512x512 PNG for a reason a size limit cannot express. */
  STORE_IMAGE_TOO_LARGE: "NEC-STORE-7005",

  // Plugin
  PLUGIN_INVALID_MANIFEST: "NEC-PLUGIN-2001",
  PLUGIN_PACKAGE_INVALID: "NEC-PLUGIN-2002",   // not a ZIP / zip-slip / missing or malformed manifest.json
  PLUGIN_ALREADY_INSTALLED: "NEC-PLUGIN-2003",
  PLUGIN_NOT_FOUND: "NEC-PLUGIN-2004",         // update/manage a plugin that isn't installed
  PLUGIN_VERSION_NOT_NEWER: "NEC-PLUGIN-2005", // update package version ≤ installed (forward-only)
  PLUGIN_UPLOAD_DISABLED: "NEC-PLUGIN-2006",   // manual .nvplugin upload is switched off by the admin
  PLUGIN_INVALID_MIGRATION: "NEC-PLUGIN-2010",
  PLUGIN_MIGRATION_MISSING: "NEC-PLUGIN-2011", // up/down migration file absent from the package
  PLUGIN_MIGRATION_CHECKSUM: "NEC-PLUGIN-2012",// applied migration modified since install
  PLUGIN_TABLE_NAMING: "NEC-PLUGIN-2013",      // migration object touches a reserved (ncf_/nodevo_) name or violates the plugin's declared tablePrefix
  PLUGIN_DISABLED: "NEC-PLUGIN-2020",
  PLUGIN_INCOMPATIBLE: "NEC-PLUGIN-2030",

  // Forum plugin (NEC-FORUM-6xxx)
  FORUM_NODE_NOT_FOUND:    "NEC-FORUM-6001",
  FORUM_THREAD_NOT_FOUND:  "NEC-FORUM-6002",
  FORUM_POST_NOT_FOUND:    "NEC-FORUM-6003",
  FORUM_POST_ACTIVE:       "NEC-FORUM-6004",
  FORUM_POST_NOT_DELETED:  "NEC-FORUM-6005",
  FORUM_NODE_CLOSED:       "NEC-FORUM-6010",
  FORUM_SELF_COMMENT:      "NEC-FORUM-6011",
  FORUM_DISLIKE_OWN:       "NEC-FORUM-6012",
  FORUM_ACCESS_DENIED:     "NEC-FORUM-6020",
  FORUM_PARTICIPANT_EXISTS:"NEC-FORUM-6030",
  FORUM_POST_COOLDOWN:     "NEC-FORUM-6040",
  FORUM_THREAD_COOLDOWN:   "NEC-FORUM-6041",

  // License / Marketplace (NEC-LICENSE-9xxx)
  LICENSE_NOT_FOUND:         "NEC-LICENSE-9001",  // no entitlement for this plugin
  LICENSE_EXPIRED:           "NEC-LICENSE-9002",  // past expiry, past grace
  LICENSE_DOMAIN_MISMATCH:   "NEC-LICENSE-9003",  // entitlement domain != this site's domain (prod)
  LICENSE_CAP_REACHED:       "NEC-LICENSE-9004",  // download gate: no free production activation slot
  LICENSE_ACCOUNT_REQUIRED:  "NEC-LICENSE-9005",  // no connected marketplace account
  LICENSE_TOKEN_INVALID:     "NEC-LICENSE-9006",  // RS256 verify failed (tampered / wrong key)
  LICENSE_SOURCE_UNREACHABLE:"NEC-LICENSE-9007",  // marketplace unreachable — grace applies
  LICENSE_ALREADY_ACTIVE:    "NEC-LICENSE-9008",  // activate refused: a license is already active
  LICENSE_SERVER_REJECTED:   "NEC-LICENSE-9009",  // license server refused (4xx) — message carries the reason
  LICENSE_SITE_ID_MISSING:   "NEC-LICENSE-9010",  // no ncf_installs row — this instance has no identity to license

  // Marketplace artifact intake (NEC-MARKETPLACE-91xx) — download-gate failures
  MARKETPLACE_NO_ARTIFACT: "NEC-MARKETPLACE-9101",      // source has no downloadable artifact
  MARKETPLACE_DOWNLOAD_FAILED: "NEC-MARKETPLACE-9102",  // download unreachable / non-200
  MARKETPLACE_ARTIFACT_INVALID: "NEC-MARKETPLACE-9103", // size cap / sha256 / manifest-id mismatch

  // Core
  CORE_THEME_NOT_FOUND: "NEC-CORE-8001",
  // An uploaded `.nvtheme` failed validation. Deliberately NOT given a localized
  // string in the `errors` namespace: the server composes a message naming the file
  // and the rule, and `apiErrorMessage` prefers a localized string when one exists —
  // so a generic code here would replace the only useful part of the response.
  CORE_THEME_INVALID: "NEC-CORE-8002",
  CORE_MAINTENANCE: "NEC-CORE-8010",   // site in maintenance mode, requester not allowed

  // Outbound mail (NEC-EMAIL-86xx)
  EMAIL_TEMPLATE_UNKNOWN: "NEC-EMAIL-8601",  // no such template key
  EMAIL_NOT_CONFIGURED:   "NEC-EMAIL-8602",  // no SMTP host set — nothing to send through
  EMAIL_SEND_FAILED:      "NEC-EMAIL-8603",  // transport rejected the message; message carries the reason

  // Queue / background jobs
  QUEUE_JOB_FAILED: "NEC-QUEUE-5000",
  QUEUE_INVALID_SCHEDULE: "NEC-QUEUE-5001",  // admin-supplied cron/interval rejected
} as const;

export type NecCode = (typeof NEC)[keyof typeof NEC] | (string & {});
