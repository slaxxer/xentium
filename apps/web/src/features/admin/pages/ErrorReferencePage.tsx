import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";

interface NecEntry {
  msg:    string;
  desc:   string;
  cause:  string;
  fix:    string;
  sev:    "Error" | "Warning" | "Info" | "Critical";
  domain: string;
}

const CATALOG: Record<string, NecEntry> = {
  // API
  "NEC-API-4001": { msg:"Validation Failed",           sev:"Warning", domain:"API", desc:"The request body, query params, or route params failed Zod validation.",          cause:"Malformed or missing fields in the request.",                                                        fix:"Check that all required fields are present and match the expected types." },
  "NEC-API-4003": { msg:"Forbidden",                   sev:"Warning", domain:"API", desc:"The authenticated user does not have permission to perform this action.",          cause:"Missing permission key for the requested resource.",                                                 fix:"Ensure the user's group has the required permission assigned in ACP → Access Control → Permissions." },
  "NEC-API-4004": { msg:"Not Found",                   sev:"Info",    domain:"API", desc:"The requested resource does not exist.",                                           cause:"Invalid ID in the URL, or the resource was deleted.",                                                fix:"Verify the resource ID. If recently deleted, this is expected." },
  "NEC-API-4009": { msg:"Conflict",                    sev:"Warning", domain:"API", desc:"The request conflicts with the current state of the resource.",                    cause:"The resource was changed by someone else, or the action was already performed (e.g. duplicate create).",  fix:"Reload the page to get the current state, then retry the action." },
  "NEC-API-4290": { msg:"Rate Limit Exceeded",         sev:"Warning", domain:"API", desc:"Too many requests from this IP or user in the configured time window.",            cause:"Automated traffic, bots, or a burst of legitimate requests.",                                         fix:"Wait for the Retry-After period indicated in the response header, then retry." },
  "NEC-API-5000": { msg:"Internal Server Error",       sev:"Error",   domain:"API", desc:"An unexpected error occurred on the server.",                                     cause:"Unhandled exception in application code. Check the Error Log for a stack trace.",                     fix:"Check ACP → System → Error Log. Report to the maintainer if persistent." },
  // Auth
  "NEC-AUTH-1001": { msg:"Invalid Credentials",        sev:"Warning", domain:"Auth", desc:"Login failed — no account matched the provided credentials.",                    cause:"Incorrect email or password.",                                                                       fix:"Double-check credentials. Use Forgot Password if needed." },
  "NEC-AUTH-1002": { msg:"Session Expired",            sev:"Info",    domain:"Auth", desc:"The access token has expired and could not be refreshed.",                       cause:"Refresh token expired or was revoked.",                                                               fix:"Log in again to start a new session." },
  "NEC-AUTH-1003": { msg:"Account Banned (Temporary)", sev:"Warning", domain:"Auth", desc:"The account is temporarily banned.",                                             cause:"A moderator or the threshold engine issued a temporary ban.",                                         fix:"Wait for the ban to expire, or appeal to a moderator." },
  "NEC-AUTH-1004": { msg:"Account Banned (Permanent)", sev:"Error",   domain:"Auth", desc:"The account is permanently banned.",                                             cause:"A moderator issued a permanent ban.",                                                                 fix:"Contact a site administrator to appeal." },
  "NEC-AUTH-1005": { msg:"Email Not Verified",         sev:"Warning", domain:"Auth", desc:"This action requires a verified email address.",                                 cause:"The user registered but has not clicked the verification link.",                                     fix:"Send a new verification email from Account Settings → Security." },
  "NEC-AUTH-1006": { msg:"Password Policy Violation",  sev:"Warning", domain:"Auth", desc:"The chosen password does not meet the site's password requirements.",            cause:"Password is too short or missing required character types.",                                          fix:"Choose a password that meets the policy shown in ACP → System → Settings → Auth." },
  "NEC-AUTH-2001": { msg:"Email Already Taken",        sev:"Warning", domain:"Auth", desc:"Registration failed — the email address is already registered.",                 cause:"An account with this email already exists.",                                                         fix:"Use a different email, or log in if this is your account." },
  "NEC-AUTH-2002": { msg:"Username Already Taken",     sev:"Warning", domain:"Auth", desc:"Registration or rename failed — the username is already in use.",                cause:"Another user holds this username, or it appears in username history.",                                fix:"Choose a different username." },
  "NEC-AUTH-2003": { msg:"Email Code Invalid or Expired", sev:"Warning", domain:"Auth", desc:"The email verification or password reset token is invalid or has expired.",  cause:"Token was already used, has expired (15 min for reset, 24 h for verify), or was tampered with.",   fix:"Request a new email from the relevant form." },
  "NEC-AUTH-1007": { msg:"Reset Token Invalid or Expired", sev:"Warning", domain:"Auth", desc:"The password reset token is invalid, already used, or expired.",                cause:"Reset links are single-use and expire 15 minutes after being issued.",                                fix:"Request a new reset link from the Forgot Password page." },
  // Permissions
  "NEC-PERM-1001": { msg:"Permission Denied",          sev:"Warning", domain:"Permissions", desc:"The user lacks the specific permission key required for this action.",    cause:"Group assignment or permission matrix does not include this key.",                                    fix:"Grant the required permission to the user's group in ACP → Access Control → Permissions." },
  "NEC-PERM-1040": { msg:"Content Too Long",           sev:"Warning", domain:"Permissions", desc:"The post or article body exceeds the maximum length for this user's level.", cause:"Group progression config restricts content length at this level.",                               fix:"Shorten the content, or adjust the group's max post length in ACP → Access Control → Groups → Progression." },
  "NEC-PERM-1041": { msg:"Daily Post Limit Reached",   sev:"Warning", domain:"Permissions", desc:"The user has reached their daily post limit.",                            cause:"Group progression config sets a daily post cap.",                                                    fix:"Wait until midnight (UTC), or raise the limit in ACP → Access Control → Groups → Progression." },
  "NEC-PERM-1042": { msg:"Attachment Limit Exceeded",  sev:"Warning", domain:"Permissions", desc:"Too many attachments on this post.",                                      cause:"Group progression config restricts attachment count.",                                                fix:"Reduce attachments, or raise the limit in the group's progression config." },
  // Articles
  "NEC-ARTICLE-3001": { msg:"Article Not Found",       sev:"Info",    domain:"Articles", desc:"The requested article does not exist or has been deleted.",                  cause:"Invalid slug or ID, or article was soft-deleted.",                                                   fix:"Verify the URL. If recently deleted, this is expected." },
  "NEC-ARTICLE-3002": { msg:"Article Not Published",   sev:"Info",    domain:"Articles", desc:"The article exists but is not in a published state.",                        cause:"Article is a draft or under review.",                                                                fix:"Publish the article from the editor, or check the status in ACP → Content → Articles." },
  "NEC-ARTICLE-3003": { msg:"Article Slug Taken",      sev:"Warning", domain:"Articles", desc:"The chosen URL slug is already used by another article.",                    cause:"Duplicate title or manually set slug.",                                                              fix:"Change the title or set a unique slug in the article editor." },
  // Storage
  "NEC-STORE-7001": { msg:"File Too Large",            sev:"Warning", domain:"Storage", desc:"The uploaded file exceeds the maximum allowed size for this upload type.",    cause:"File size exceeds the limit defined in UPLOAD_LIMITS config.",                                       fix:"Compress or resize the file, or increase the limit in the server config." },
  "NEC-STORE-7002": { msg:"File Type Not Permitted",   sev:"Warning", domain:"Storage", desc:"The file type is not allowed for this upload slot or user level.",            cause:"MIME type check failed, or group progression config restricts this type.",                          fix:"Use an allowed file type. Admins can adjust group-level type restrictions in Progression config." },
  "NEC-STORE-7003": { msg:"MIME Type Mismatch",        sev:"Warning", domain:"Storage", desc:"The file's magic bytes don't match the declared Content-Type.",               cause:"File was renamed to appear as a different type.",                                                    fix:"Upload the correct file. Do not rename files to bypass type checks." },
  "NEC-STORE-7004": { msg:"Path Forbidden",            sev:"Error",   domain:"Storage", desc:"The requested storage path is outside the allowed public directories.",       cause:"Attempt to access a private storage path (plugins/, themes/packs/, temp/) directly.",              fix:"Access plugin or style pack files through their authenticated API endpoints." },
  // Plugin
  "NEC-PLUGIN-2001": { msg:"Invalid Plugin Manifest",  sev:"Error",   domain:"Plugin Engine", desc:"The uploaded plugin package is missing required manifest.json fields.", cause:"Plugin was built with an outdated SDK or has a malformed manifest.",                               fix:"Check manifest.json against the current plugin manifest schema. Required fields: id, name, version, vendor, minNodevoVersion." },
  "NEC-PLUGIN-2002": { msg:"Invalid Plugin Package",   sev:"Error",   domain:"Plugin Engine", desc:"The uploaded .nvplugin file is not a valid plugin package.",           cause:"Not a ZIP archive, an unsafe (path-traversal) entry, or manifest.json is missing / not valid JSON.",  fix:"Re-download the package from its source. If self-built, rebuild it with the plugin SDK packager." },
  "NEC-PLUGIN-2003": { msg:"Plugin Already Installed", sev:"Warning", domain:"Plugin Engine", desc:"A plugin with this id is already installed on this site.",             cause:"The package was uploaded twice, or an update was attempted through the install flow.",              fix:"Uninstall the existing plugin first, or use the update flow in ACP → Extensions → Installed." },
  "NEC-PLUGIN-2004": { msg:"Plugin Not Installed",     sev:"Warning", domain:"Plugin Engine", desc:"An update or management action targeted a plugin that is not installed on this site.", cause:"The plugin was uninstalled, or the request named the wrong plugin id.",                             fix:"Install the plugin first from ACP → Extensions → Marketplace, then retry." },
  "NEC-PLUGIN-2005": { msg:"Update Not Newer",         sev:"Warning", domain:"Plugin Engine", desc:"The update package version is not newer than the installed version.",   cause:"Updates are forward-only; the package version is the same as or older than what is installed.",     fix:"No action needed — the installed version is already current." },
  "NEC-PLUGIN-2010": { msg:"Invalid Migration SQL",    sev:"Error",   domain:"Plugin Engine", desc:"A plugin migration file contains non-DDL SQL statements.",              cause:"The plugin's migration files include INSERT/UPDATE/DELETE/SELECT — only DDL is allowed.",           fix:"Contact the plugin vendor. Migration files must only use CREATE/ALTER/DROP TABLE/INDEX statements." },
  "NEC-PLUGIN-2011": { msg:"Migration File Missing",   sev:"Error",   domain:"Plugin Engine", desc:"A migration listed in the manifest has no matching .up.sql / .down.sql file in the package.", cause:"The package was built incompletely — every up migration must ship a matching down migration.", fix:"Contact the plugin vendor for a correctly packaged build." },
  "NEC-PLUGIN-2012": { msg:"Migration Checksum Mismatch", sev:"Error", domain:"Plugin Engine", desc:"An already-applied migration file differs from the one recorded at install time.",  cause:"The plugin package ships a modified version of a migration this site already ran.",           fix:"Do not edit applied migrations. The vendor must ship schema changes as a NEW migration in the next version." },
  "NEC-PLUGIN-2020": { msg:"Plugin Not Available",     sev:"Info",    domain:"Plugin Engine", desc:"The requested plugin route is not available.",                          cause:"Plugin is installed but currently disabled.",                                                        fix:"Enable the plugin in ACP → Extensions → Installed." },
  "NEC-PLUGIN-2030": { msg:"Plugin Incompatible",      sev:"Error",   domain:"Plugin Engine", desc:"The plugin's supported Nodevo version range does not include this platform version.", cause:"The manifest's minNodevoVersion is newer than this installation, or maxNodevoVersion is older.", fix:"Update Nodevo, or install a plugin version built for this platform version." },
  // Core
  "NEC-CORE-8001":  { msg:"Theme Not Found",           sev:"Error",   domain:"Core", desc:"The requested theme is not registered in the ThemeRegistry.",                   cause:"Theme ID does not match any registered theme.",                                                      fix:"Re-enable the theme or upload its package again." },
  "NEC-CORE-8002":  { msg:"Invalid Style Pack",        sev:"Warning", domain:"Core", desc:"The uploaded .nvstyle package failed validation — the message names the file and rule.", cause:"Missing manifest.json / styles/light.css / styles/dark.css, or the CSS contains rules beyond :root custom properties.", fix:"Style packs may only set CSS custom properties on :root. Rebuild the pack; see the theming docs." },
  "NEC-CORE-8010":  { msg:"Site Under Maintenance",    sev:"Info",    domain:"Core", desc:"The site is in maintenance mode and the requester is not in the allowed bypass group. This is an intentional state, not a fault — every blocked request returns this code, so it is NOT written to the Error Log (that would flood it). Enabling/disabling maintenance is recorded in the Activity Log.", cause:"An admin turned on maintenance mode (ACP → System → Settings → Maintenance). Only the configured allowed group and admins can bypass it.", fix:"To restore the site, disable maintenance mode in ACP → System → Settings. Staff can sign in on the maintenance screen to bypass it." },
  // Pages
  "NEC-PAGE-3501":  { msg:"Page Not Found",            sev:"Info",    domain:"Page", desc:"The requested custom page does not exist.",                                      cause:"The page slug is wrong, or the page was deleted/unpublished.",                                        fix:"Check the slug in ACP → Content → Pages, or create the page." },
  "NEC-PAGE-3502":  { msg:"Page Slug Taken",           sev:"Warning", domain:"Page", desc:"Another page already uses this slug.",                                           cause:"Slugs must be unique; the chosen slug collides with an existing page.",                               fix:"Choose a different slug for the page in ACP → Content → Pages." },
  // Queue / background jobs
  "NEC-QUEUE-5000": { msg:"Background Job Failed",     sev:"Error",   domain:"Queue", desc:"A background (BullMQ) job threw an error and failed after exhausting all retries. This is a wrapper code — it tells you a job died, not why.", cause:"The real cause is in THIS Error Log entry's own fields: read the message (e.g. a Prisma/SQL error, a network failure, or a job bug) and the context (queue, jobName, jobId). The NEC code is only the category.", fix:"Open the matching Error Log entry, read its message + context, and fix the underlying cause. Restart the worker process so it picks up the fix; the job re-runs on its next schedule. If the message points to an application bug, report it to the maintainer verbatim." },
  "NEC-QUEUE-5001": { msg:"Invalid Job Schedule",      sev:"Warning", domain:"Queue", desc:"A schedule submitted in ACP → System → Scheduled Tasks was rejected.", cause:"The cron expression was malformed, or the schedule would fire more often than the job's minimum interval.", fix:"Use a valid 5-field cron expression, or choose a less frequent interval. The rejected schedule is not saved." },
  // License / Marketplace
  "NEC-LICENSE-9001": { msg:"License Not Found",         sev:"Warning", domain:"License", desc:"No valid entitlement exists for this plugin.",                                  cause:"The plugin requires a license but none is activated for this site.",                                  fix:"Activate a license in ACP → Extensions → License, or connect a marketplace account." },
  "NEC-LICENSE-9002": { msg:"License Expired",           sev:"Warning", domain:"License", desc:"The entitlement is past expiry and the grace period has elapsed.",               cause:"The license lapsed and the 30-day offline grace window ended.",                                       fix:"Refresh or renew the license in ACP → Extensions → License. Already-enabled plugins keep running." },
  "NEC-LICENSE-9003": { msg:"License Domain Mismatch",   sev:"Warning", domain:"License", desc:"The entitlement is bound to a different domain than this site (production only).", cause:"The site's canonical URL (site.url) host differs from the domain the license was activated for.",                  fix:"Re-bind the license to this domain, or activate on the correct domain." },
  "NEC-LICENSE-9004": { msg:"Activation Cap Reached",    sev:"Warning", domain:"License", desc:"The download gate found no free production activation slot for this purchase.", cause:"All licensed production domains for this purchase are already in use.",                               fix:"Free a slot, or buy an additional domain on nodevo.io." },
  "NEC-LICENSE-9005": { msg:"Marketplace Account Required", sev:"Info", domain:"License", desc:"This action needs a connected marketplace account.",                           cause:"No nodevo.io account is connected for this site.",                                                    fix:"Connect an account in ACP → Extensions → Marketplace, or use a manual license key." },
  "NEC-LICENSE-9006": { msg:"Entitlement Token Invalid", sev:"Error",   domain:"License", desc:"The stored entitlement JWT failed RS256 verification.",                          cause:"The token was tampered with, or the verifying public key does not match the issuer.",                 fix:"Re-activate the license. In production, confirm the bundled license public key matches nodevo.io's signing key." },
  "NEC-LICENSE-9007": { msg:"Marketplace Unreachable",   sev:"Warning", domain:"License", desc:"The marketplace / license server could not be reached.",                         cause:"Network failure or the license server is down. The 30-day grace period applies.",                    fix:"Check connectivity. Running plugins are unaffected during the grace window; retry later." },
  "NEC-LICENSE-9008": { msg:"License Already Active",   sev:"Warning", domain:"License", desc:"Activation was refused because this site already has an active license.",       cause:"A second key was entered (or account auto-activation ran) while a license is active.",               fix:"Deactivate the current license in ACP → Extensions → License first, then activate the new one." },
  "NEC-LICENSE-9009": { msg:"License Server Refused",    sev:"Warning", domain:"License", desc:"The license server rejected the request — the message carries the exact reason.", cause:"Unknown or revoked key, ended license term, no free domain slot, or the license is bound to another domain.",  fix:"Read the message: renew the term, free/add a domain slot, or contact marketplace support to move the binding." },
};

const CORE_DOMAINS = ["API", "Auth", "Permissions", "Articles", "Page", "Storage", "Plugin Engine", "Core", "Queue", "License"];

const SEV_COLOR: Record<string, string> = {
  Critical: "var(--c-danger)",
  Error:    "var(--c-danger)",
  Warning:  "var(--c-warn)",
  Info:     "var(--c-accent)",
};

function Badge({ label, color = "var(--c-accent)" }: { label: string; color?: string }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:`${color}20`, color }}>
      {label}
    </span>
  );
}

export function ErrorReferencePage() {
  const { t } = useTranslation("acp");
  const [code,     setCode]     = useState("");
  const [filter,   setFilter]   = useState("");
  const [domain,   setDomain]   = useState("");
  const [result,   setResult]   = useState<(NecEntry & { code: string }) | { notfound: true; code: string } | null>(null);

  // Fetch plugin-registered NEC codes
  const { data: rawPluginCodes } = useQuery<Record<string, NecEntry>[]>({
    queryKey: ["admin-nec-codes"],
    queryFn:  () => api.get<Record<string, NecEntry>[]>("/admin/nec-codes").catch(() => [] as Record<string, NecEntry>[]),
    staleTime: 300_000,
  });
  const pluginCodes = (rawPluginCodes ?? []) as unknown as Array<NecEntry & { code: string }>;

  // Merge plugin codes into catalog for lookup and filtering
  const fullCatalog: Record<string, NecEntry> = {
    ...CATALOG,
    ...Object.fromEntries(pluginCodes.map((c) => [c.code, c])),
  };
  const pluginDomains = [...new Set(pluginCodes.map((c) => c.domain))];
  const DOMAINS = [...CORE_DOMAINS, ...pluginDomains];

  function lookup(c = code) {
    const key = c.toUpperCase().trim();
    const r   = fullCatalog[key];
    setResult(r ? { ...r, code: key } : { notfound: true, code: key });
  }

  // Deep-link support: the fatal-error overlay sends the admin here with ?code=NEC-...
  // Auto-fill + auto-lookup once the (plugin-augmented) catalog is ready.
  const [searchParams] = useSearchParams();
  const paramCode = searchParams.get("code");
  useEffect(() => {
    if (!paramCode) return;
    const key = paramCode.toUpperCase().trim();
    setCode(key);
    setResult(fullCatalog[key] ? { ...fullCatalog[key], code: key } : { notfound: true, code: key });
  }, [paramCode, rawPluginCodes]);

  const filtered = Object.entries(fullCatalog).filter(([k, v]) => {
    const q = filter.toLowerCase();
    const domMatch = !domain || v.domain === domain;
    const textMatch = !q || k.toLowerCase().includes(q) || v.msg.toLowerCase().includes(q) || v.domain.toLowerCase().includes(q);
    return domMatch && textMatch;
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("errorRef.title")}</h1>
        </div>
      </div>

      {/* Lookup */}
      <div className="acp-card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-fg)", marginBottom: 10 }}>{t("errorRef.lookupTitle")}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="acp-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("errorRef.lookupPlaceholder")}
            style={{ fontFamily: "monospace", letterSpacing: "0.05em", flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button type="button" className="btn-primary btn-sm" onClick={() => lookup()}>
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ marginRight: 5 }} /> {t("errorRef.lookupBtn")}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        "notfound" in result ? (
          <div className="acp-card" style={{ padding: 24, textAlign: "center", marginBottom: 20 }}>
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: 28, color: "var(--c-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-fg)" }}>{t("errorRef.notFoundTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--c-fg-muted)", marginTop: 4 }}>{t("errorRef.notFoundBody", { code: result.code })}</div>
          </div>
        ) : (
          <div className="acp-card" style={{ padding: 24, marginBottom: 20, borderLeft: `3px solid ${SEV_COLOR[result.sev]}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: "var(--c-accent)", background: "var(--c-accent-soft)", border: "1px solid var(--c-accent-glow)", padding: "5px 12px", borderRadius: "var(--radius-sm)" }}>
                {result.code}
              </span>
              <Badge label={result.sev} color={SEV_COLOR[result.sev]} />
              <Badge label={result.domain} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--c-fg)", marginBottom: 20 }}>{result.msg}</div>
            {([[t("errorRef.whatHappened"), result.desc], [t("errorRef.likelyCause"), result.cause], [t("errorRef.suggestedFix"), result.fix]] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.7 }}>{val}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Catalog browser */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          className="acp-input"
          placeholder={t("errorRef.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <select className="acp-select" style={{ width: "auto" }} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">{t("errorRef.allDomains")}</option>
          {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <FontAwesomeIcon icon={faCircleInfo} style={{ fontSize: 24, color: "var(--c-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>{t("errorRef.noMatch")}</div>
          </div>
        ) : filtered.map(([k, v], i) => (
          <div
            key={k}
            onClick={() => { setCode(k); lookup(k); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            style={{ display: "grid", gridTemplateColumns: "180px 1fr 100px 90px", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < filtered.length - 1 ? "1px solid var(--c-border)" : "none", cursor: "pointer", transition: "background 0.12s" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-accent-soft)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "var(--c-accent)" }}>{k}</div>
            <div style={{ fontSize: 13, color: "var(--c-fg)" }}>{v.msg}</div>
            <div style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>{v.domain}</div>
            <Badge label={v.sev} color={SEV_COLOR[v.sev]} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 10, textAlign: "right" }}>
        {t("errorRef.countSummary", { shown: filtered.length, total: Object.keys(fullCatalog).length })}
      </div>
    </div>
  );
}
