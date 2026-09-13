import mysql from "mysql2/promise";
import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationInspection, MigrationReporter } from "@xentium/migrate-core";
import { extractXenforo, xfVersion } from "./extract.js";

const DEFAULT_PREFIX = "xf_";

/**
 * XenForo 2.x → Xentium adapter (§34, Wave 1). Direct MySQL source; the
 * xentium-forum plugin must be enabled on the target (hard precondition —
 * a forum board without the forum plugin would have no content).
 */
export const xenforoAdapter: MigrateAdapter = {
  name: "xenforo",
  version: "1.0.0-alpha.0",
  requiredPlugins: ["xentium-forum"],

  async inspect(source: AdapterSource): Promise<MigrationInspection> {
    if (!source.db) {
      return {
        platform: "XenForo",
        counts: {},
        warnings: [],
        preconditions: { met: [], missing: ["--source-db mysql://user:pass@host/xenforo_db"] },
      };
    }
    const prefix = source.tablePrefix ?? DEFAULT_PREFIX;
    const version = await xfVersion({ db: source.db, tablePrefix: prefix });

    const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
    const count = async (sql: string): Promise<number> => {
      const [rows] = await conn.query(sql);
      return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
    };
    try {
      const counts = {
        users:   await count(`SELECT COUNT(*) n FROM ${prefix}user`),
        nodes:   await count(`SELECT COUNT(*) n FROM ${prefix}node WHERE node_type_id IN ('Category','Forum')`),
        threads: await count(`SELECT COUNT(*) n FROM ${prefix}thread WHERE discussion_state = 'visible'`),
        posts:   await count(`SELECT COUNT(*) n FROM ${prefix}post WHERE message_state = 'visible'`),
      };
      const warnings = [
        "XenForo's per-node permission overrides cannot be represented in Xentium's flat RBAC — admins map to Administrator, moderators to Moderator, everyone else to Member (§34, lossy by design).",
        "Users with XenForo's native bcrypt hashes keep their passwords (verified on first login, upgraded to argon2). Accounts on legacy import schemes reset once.",
        "Attachments, private conversations and media embeds are not migrated in this version (embeds become plain links).",
        "Reactions migrate as likes: every reaction type (love, haha, …) collapses to a Xentium like. Follows and ignores (→ blocks) migrate 1:1.",
      ];
      const missing: string[] = [];
      if (version !== "unknown" && !version.startsWith("2.")) {
        missing.push(`XenForo 2.x required (detected ${version}) — upgrade the board first`);
      }
      return {
        platform: `XenForo ${version}`,
        counts,
        warnings,
        preconditions: { met: [`Source DB connected (XenForo ${version})`], missing },
      };
    } finally {
      await conn.end();
    }
  },

  async extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult> {
    if (!source.db) throw new Error("XenForo adapter needs --source-db mysql://…");
    return extractXenforo({ db: source.db, tablePrefix: source.tablePrefix ?? DEFAULT_PREFIX }, reporter);
  },
};

export { xfBbcodeToHtml, extractBcryptHash } from "./bbcode.js";
export default xenforoAdapter;
