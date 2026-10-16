import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationInspection, MigrationReporter } from "@xentium/migrate-core";
import { parseWxr } from "./wxr.js";

/**
 * WordPress → Xentium adapter (§34, Wave 1). Source is a WXR export file
 * (Tools → Export → "All content" in wp-admin) — no WP install needed.
 */
export const wordpressAdapter: MigrateAdapter = {
  name: "wordpress",
  version: "1.0.0-alpha.0",

  async inspect(source: AdapterSource): Promise<MigrationInspection> {
    if (!source.file) {
      return {
        platform: "WordPress",
        counts: {},
        warnings: [],
        preconditions: { met: [], missing: ["--file <export.xml> (WXR export from wp-admin → Tools → Export)"] },
      };
    }
    const parsed = parseWxr(source.file);
    const warnings = [
      "WXR exports contain no password hashes — imported users keep their account (matched by email) but must use \"forgot password\" once.",
      "WXR exports contain no user roles — all users are imported into the Member group.",
    ];
    if (parsed.guestComments > 0) {
      warnings.push(`${parsed.guestComments} guest comments cannot be imported (Xentium comments require an account) — they are listed in the migration report.`);
    }
    if (parsed.otherTypes["attachment"]) {
      warnings.push(`${parsed.otherTypes["attachment"]} media attachments are referenced by URL and not downloaded in this version.`);
    }
    if (parsed.otherTypes["page"]) {
      warnings.push(`${parsed.otherTypes["page"]} pages are skipped (Xentium has no page entity in v1).`);
    }
    return {
      platform: parsed.sourceInfo,
      counts: {
        users: parsed.users.length,
        categories: parsed.categories.length,
        posts: parsed.articles.length,
        comments: parsed.comments.length,
        skipped: parsed.skipped.length,
      },
      warnings,
      preconditions: { met: ["WXR file readable"], missing: [] },
    };
  },

  async extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult> {
    if (!source.file) throw new Error("WordPress adapter needs --file <export.xml>");
    reporter.info(`Parsing WXR export: ${source.file}`);
    const parsed = parseWxr(source.file);
    reporter.info(
      `Found ${parsed.users.length} users, ${parsed.categories.length} categories, ` +
      `${parsed.articles.length} posts, ${parsed.comments.length} comments ` +
      `(${parsed.skipped.length} skipped)`,
    );
    return parsed;
  },

  /** `?p=12` links by pattern; pretty permalinks and author pages from the export itself. */
  async redirects(source: AdapterSource) {
    if (!source.file) throw new Error("WordPress adapter needs --file <export.xml>");
    return {
      patterns: [{ entity: "article", regex: String.raw`^/(?:[^?]*/)?(?:index\.php)?\?(?:[^#]*[&;])?p=(?<id>\d+)` }],
      exact: parseWxr(source.file).permalinks,
    };
  },
};

export { parseWxr } from "./wxr.js";
export default wordpressAdapter;
