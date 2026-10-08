/**
 * An ACP action as a sentence: `PATCH /api/admin/error-log/groups/121af…` →
 * "Resolved error group · 121af96c". The log stores only the method and the path, so
 * the phrase comes from the route; anything not listed reads as "Changed <area>".
 *
 * Keys are `activity.verb.*` in the `acp` namespace. A pattern's capture group is the
 * target, shortened when it is an id.
 */

/** [method, path after /api/admin, verb key, which capture is the target]. */
type Rule = [string, RegExp, string, number?];

const RULES: Rule[] = [
  ["PUT",    /^\/settings\/([^/]+)$/,                 "settingChanged", 1],
  ["POST",   /^\/users$/,                             "userCreated"],
  ["POST",   /^\/users\/([^/]+)\/ban$/,               "userBanned", 1],
  ["DELETE", /^\/users\/([^/]+)\/ban$/,               "userUnbanned", 1],
  ["PUT",    /^\/users\/([^/]+)\/groups$/,            "userGroups", 1],
  ["PATCH",  /^\/users\/([^/]+)\/groups$/,            "userGroups", 1],
  ["PATCH",  /^\/users\/([^/]+)\/active$/,            "userActive", 1],
  ["POST",   /^\/users\/([^/]+)\/force-logout$/,      "userSignedOut", 1],
  ["POST",   /^\/users\/([^/]+)\/password-reset$/,    "userPasswordReset", 1],
  ["POST",   /^\/profile-fields$/,                    "profileFieldAdded"],
  ["PATCH",  /^\/profile-fields\/([^/]+)$/,           "profileFieldChanged", 1],
  ["DELETE", /^\/profile-fields\/([^/]+)$/,           "profileFieldDeleted", 1],
  ["PUT",    /^\/profile-fields\/reorder$/,           "profileFieldsReordered"],
  ["DELETE", /^\/articles\/([^/]+)$/,                 "articleDeleted", 1],
  ["PATCH",  /^\/reports\/([^/]+)$/,                  "reportHandled", 1],
  ["POST",   /^\/warnings$/,                          "warningIssued"],
  ["PATCH",  /^\/warnings\/([^/]+)\/pardon$/,         "warningPardoned", 1],
  ["PATCH",  /^\/cases\/([^/]+)\/notes$/,             "caseNotes", 1],
  ["PATCH",  /^\/cases\/([^/]+)\/assign$/,            "caseAssigned", 1],
  ["POST",   /^\/cases\/([^/]+)\/ban-all$/,           "caseBanAll", 1],
  ["POST",   /^\/cases\/([^/]+)\/revoke-exception$/,  "caseException", 1],
  ["PATCH",  /^\/cases\/([^/]+)$/,                    "caseUpdated", 1],
  ["POST",   /^\/mod-templates\/restore-defaults$/,   "modTemplatesRestored"],
  ["POST",   /^\/mod-templates$/,                     "modTemplateAdded"],
  ["PATCH",  /^\/mod-templates\/([^/]+)$/,            "modTemplateChanged", 1],
  ["DELETE", /^\/mod-templates\/([^/]+)$/,            "modTemplateDeleted", 1],
  ["PATCH",  /^\/mod-settings$/,                      "modSettingsChanged"],
  ["DELETE", /^\/comments\/(?:article|profile)\/([^/]+)$/, "commentDeleted", 1],
  ["POST",   /^\/license\/refresh$/,                  "licenseRefreshed"],
  ["DELETE", /^\/license$/,                           "licenseRemoved"],
  ["DELETE", /^\/error-log$/,                         "errorLogCleared"],
  ["PATCH",  /^\/error-log\/groups\/([^/]+)$/,        "errorGroupChanged", 1],
  ["DELETE", /^\/error-log\/groups\/([^/]+)$/,        "errorGroupDeleted", 1],
  ["DELETE", /^\/error-log\/([^/]+)$/,                "errorEntryDeleted", 1],
  ["PATCH",  /^\/auth-providers\/([^/]+)$/,           "signInProviderChanged", 1],
  ["PUT",    /^\/jobs\/([^/]+)$/,                     "jobScheduled", 1],
  ["POST",   /^\/jobs\/([^/]+)\/run$/,                "jobRun", 1],
  ["POST",   /^\/nav-items$/,                         "navItemAdded"],
  ["PATCH",  /^\/nav-items\/reorder$/,                "navReordered"],
  ["PATCH",  /^\/nav-items\/([^/]+)$/,                "navItemChanged", 1],
  ["DELETE", /^\/nav-items\/([^/]+)$/,                "navItemDeleted", 1],
  ["POST",   /^\/marketplace\/install$/,              "pluginInstalled"],
  ["POST",   /^\/marketplace\/update$/,               "pluginUpdated"],
  ["POST",   /^\/marketplace\/(?:connection|link|authorize)$/, "marketplaceConnected"],
  ["DELETE", /^\/marketplace\/connection$/,           "marketplaceDisconnected"],
  ["POST",   /^\/marketplace\/updates\/core\/acknowledge$/, "coreUpdateSeen"],
  ["POST",   /^\/announcements\/([^/]+)\/dismiss$/,   "announcementDismissed"],
  ["PATCH",  /^\/groups\/([^/]+)\/permissions$/,      "groupPermissions", 1],
  ["PUT",    /^\/groups\/([^/]+)\/permissions$/,      "groupPermissions", 1],
  ["PUT",    /^\/groups\/reorder$/,                    "groupsReordered"],
  ["POST",   /^\/groups\/([^/]+)\/(?:icon|rank-image)$/, "groupImage", 1],
  ["DELETE", /^\/groups\/([^/]+)\/(?:icon|rank-image)$/, "groupImageRemoved", 1],
  ["POST",   /^\/groups$/,                            "groupCreated"],
  ["PATCH",  /^\/groups\/([^/]+)$/,                   "groupChanged", 1],
  ["DELETE", /^\/groups\/([^/]+)$/,                   "groupDeleted", 1],
  ["PATCH",  /^\/progression\/settings$/,             "progressionSettings"],
  ["PATCH",  /^\/progression\/reorder$/,              "progressionReordered"],
  ["PATCH",  /^\/progression\/([^/]+)$/,              "progressionRule", 1],
  ["POST",   /^\/themes\/import$/,                    "themeInstalled"],
  ["POST",   /^\/themes\/export$/,                    "themeExported"],
  ["POST",   /^\/themes\/library\/([^/]+)\/activate$/, "themeActivated", 1],
  ["POST",   /^\/themes\/core\/activate$/,            "themeCoreActivated"],
  ["POST",   /^\/themes\/colourway$/,                 "themeColourway"],
  ["POST",   /^\/themes\/discard$/,                   "themeUndone"],
  ["DELETE", /^\/themes\/library\/([^/]+)$/,          "themeRemoved", 1],
  ["POST",   /^\/themes\/studio\/publish$/,           "themePublished"],
  ["POST",   /^\/email\/test$/,                       "emailTest"],
  ["PUT",    /^\/email\/templates\/([^/]+)$/,         "emailTemplate", 1],
  ["POST",   /^\/email\/templates\/([^/]+)\/reset$/,  "emailTemplateReset", 1],
  ["PUT",    /^\/layouts\/([^/]+)/,                   "layoutSaved", 1],
  ["POST",   /^\/layouts\/([^/]+)\/publish$/,         "layoutPublished", 1],
  ["POST",   /^\/badges$/,                            "badgeCreated"],
  ["PATCH",  /^\/badges\/([^/]+)$/,                   "badgeChanged", 1],
  ["DELETE", /^\/badges\/([^/]+)$/,                   "badgeDeleted", 1],
  ["POST",   /^\/badges\/([^/]+)\/award/,             "badgeAwarded", 1],
  ["PUT",    /^\/legal\/([^/]+)$/,                    "legalSaved", 1],
  ["POST",   /^\/legal\/([^/]+)\/publish$/,           "legalPublished", 1],
  ["POST",   /^\/invites$/,                           "inviteCreated"],
  ["DELETE", /^\/invites\/([^/]+)$/,                  "inviteDeleted", 1],
];

/** Every key `humanize` can return — each must exist in `activity.verb.*` in every locale. */
export const VERB_KEYS: string[] = [...new Set([...RULES.map((r) => r[2]), "genericPost", "genericChange", "genericDelete"])];

/** A long id is shortened to its first 8 characters; names and keys stay whole. */
const shortId = (s: string) => (/^[0-9a-f-]{20,}$/i.test(s) || /^c[a-z0-9]{20,}$/.test(s) ? s.slice(0, 8) : decodeURIComponent(s));

/** "error-log" → "error log". */
export const areaOf = (path: string): string => {
  const seg = path.replace(/^\/api\/admin\//, "").split("/")[0] ?? "";
  return seg.replace(/-/g, " ");
};

export interface Humanized {
  /** `activity.verb.<key>`; `generic` uses `{{area}}`. */
  verbKey: string;
  target: string;
  /** For `generic`. */
  area: string;
}

/**
 * Turn one action into words. `targets` maps the user and group ids in paths to what to
 * print (the server's `targets`: "@spamlord", "Moderator"), so nothing reads as an id.
 */
export function humanize(method: string | null, path: string, targets: Record<string, string> = {}): Humanized {
  const rel = path.replace(/^\/api\/admin/, "");
  for (const [m, re, key, group] of RULES) {
    if (m !== method) continue;
    const hit = re.exec(rel);
    if (!hit) continue;
    const raw = group ? hit[group] ?? "" : "";
    const target = raw ? targets[raw] ?? shortId(raw) : "";
    return { verbKey: key, target, area: areaOf(path) };
  }
  const generic = method === "DELETE" ? "genericDelete" : method === "POST" ? "genericPost" : "genericChange";
  return { verbKey: generic, target: "", area: areaOf(path) };
}

/** "Chrome 129 · Windows" from a user agent — enough to tell two sessions apart. */
export function browserOf(ua: string | null): string {
  if (!ua) return "";
  const browser =
    /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
    : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}`
    : "";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}
