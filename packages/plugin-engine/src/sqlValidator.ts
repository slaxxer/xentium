import { XentiumError, XEC } from "@xentium/errors";
// Validates that a plugin migration SQL file contains only DDL statements.
// Rejects any DML (INSERT/UPDATE/DELETE/SELECT/TRUNCATE/COPY) or anything else.
// Returns true if valid, throws with a descriptive message if not.

const ALLOWED_DDL =
  /^\s*(CREATE(\s+OR\s+REPLACE)?|ALTER|DROP|COMMENT)\s+(TABLE|INDEX|UNIQUE\s+INDEX|SEQUENCE|TYPE|EXTENSION|FUNCTION|TRIGGER)\b/i;
const DISALLOWED = /^\s*(INSERT|UPDATE|DELETE|SELECT|TRUNCATE|COPY|MERGE|CALL|EXEC|GRANT|REVOKE|LOCK)\b/i;

// Namespaces a plugin migration may never create/alter/drop into: core tables
// (`xcf_`, and `ncf_` which a database predating the rename still uses),
// core-owned bookkeeping (`nodevo_` and `xentium_` — the pre- and
// post-rename prefixes; existing databases still carry nodevo_ objects),
// Prisma's internal tables, and Postgres system catalogs. Enforced for EVERY
// plugin, whether or not it declares a tablePrefix.
const RESERVED_NAME = /^(xcf_|ncf_|nodevo_|xentium_|_prisma|pg_|information_schema)/i;

/**
 * Naming policy for a plugin's migrations. `tablePrefix` (when the manifest
 * declares one) is the required prefix for every object the migration governs.
 */
export interface MigrationSqlPolicy {
  tablePrefix?: string;
}

/**
 * Normalize an identifier token to the bare, lowercased object name: drop any
 * schema qualifier (`public.foo` → `foo`), strip double-quotes, and trailing
 * punctuation the split may have left attached.
 */
function normalizeIdent(token: string): string {
  const parts = token.split(".");
  const last  = parts[parts.length - 1] ?? "";
  return last.replace(/["'`;(),]/g, "").trim().toLowerCase();
}

const IDENT = `[\\w."]+`;

/**
 * Extract the object names a single DDL statement governs — the tables it
 * creates/alters/drops/indexes, plus created indexes/sequences/types/functions/
 * triggers. `CREATE EXTENSION` (global objects like pg_trgm) and `COMMENT`
 * govern nothing of the plugin's own, so they return no names and are exempt.
 */
function extractGovernedNames(stmt: string): string[] {
  const s     = stmt.replace(/\s+/g, " ").trim();
  const names: string[] = [];
  let m: RegExpExecArray | null;

  if (/^CREATE\s+EXTENSION\b/i.test(s) || /^DROP\s+EXTENSION\b/i.test(s) || /^COMMENT\b/i.test(s)) {
    return names; // exempt
  }

  if ((m = new RegExp(`^CREATE\\s+(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMP(?:ORARY)?\\s+)?(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!);
  } else if ((m = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!);
  } else if ((m = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT}(?:\\s*,\\s*${IDENT})*)`, "i").exec(s))) {
    for (const part of m[1]!.split(",")) names.push(part);
  } else if ((m = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:(${IDENT})\\s+)?ON\\s+(?:ONLY\\s+)?(${IDENT})`, "i").exec(s))) {
    if (m[1]) names.push(m[1]);      // index name is optional in Postgres
    names.push(m[2]!);               // ...but the table it indexes is not
  } else if ((m = new RegExp(`^CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?SEQUENCE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!);
  } else if ((m = new RegExp(`^CREATE\\s+TYPE\\s+(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!);
  } else if ((m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(${IDENT}?)\\s*\\(`, "i").exec(s))) {
    names.push(m[1]!);
  } else if ((m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(${IDENT})\\b`, "i").exec(s))) {
    names.push(m[1]!);
    const on = new RegExp(`\\bON\\s+(${IDENT})`, "i").exec(s);
    if (on) names.push(on[1]!);      // a trigger must live on a plugin-owned table
  } else if ((m = new RegExp(`^DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!, m[2]!);
  } else if ((m = new RegExp(`^DROP\\s+(?:INDEX|SEQUENCE|TYPE|FUNCTION)\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT})`, "i").exec(s))) {
    names.push(m[1]!);
  }

  return names.map(normalizeIdent).filter(Boolean);
}

/**
 * Split SQL into statements on top-level semicolons, while keeping
 * dollar-quoted bodies ($$ … $$ or $tag$ … $tag$) and single-quoted string
 * literals intact. This lets plugin migrations define functions and triggers
 * whose bodies contain semicolons.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let dollarTag: string | null = null;
  let i = 0;

  while (i < sql.length) {
    if (dollarTag) {
      // Inside a dollar-quoted body — look for the matching closing tag.
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += sql[i++];
      }
      continue;
    }

    const ch = sql[i]!;

    // Line comment — skip to end of line (so semicolons in comments don't split).
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Block comment — skip to closing */.
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Opening of a dollar-quoted body: $tag$ where tag is [A-Za-z0-9_]*
    if (ch === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        current += m[0];
        i += m[0].length;
        continue;
      }
    }

    // Single-quoted string literal — copy verbatim, handling '' escapes.
    if (ch === "'") {
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

// Strip leading comments/whitespace from a single statement so the
// ALLOWED/DISALLOWED checks see the real leading keyword. This is applied
// PER STATEMENT after the quote-aware split — never to the whole file — so a
// `--` inside a string literal can't delete the rest of a statement.
function leadingKeyword(stmt: string): string {
  return stmt
    .replace(/^(?:\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "")
    .trim();
}

export function validateMigrationSql(sql: string, filename: string, policy?: MigrationSqlPolicy): void {
  if (!sql.trim()) return;

  const prefix = policy?.tablePrefix;

  // IMPORTANT: split with the SAME quote-/dollar-/comment-aware tokenizer the
  // runner uses (migration-runner.ts), so the validator and executor can never
  // disagree on statement boundaries. The previous regex comment-strip ran
  // BEFORE the split and treated `--` inside a 'string literal' as a comment,
  // letting a smuggled trailing DML statement bypass this DDL-only allowlist.
  for (const rawStmt of splitSqlStatements(sql)) {
    const stmt = leadingKeyword(rawStmt);
    if (!stmt) continue; // comment-only / empty
    if (DISALLOWED.test(stmt)) {
      throw new XentiumError({
        code:       XEC.PLUGIN_INVALID_MIGRATION,
        httpStatus: 422,
        message:    `${filename} contains a disallowed statement: "${stmt.slice(0, 60)}…". Only DDL (CREATE/ALTER/DROP TABLE/INDEX/FUNCTION/TRIGGER) is permitted in plugin migrations.`,
      });
    }
    if (!ALLOWED_DDL.test(stmt)) {
      throw new XentiumError({
        code:       XEC.PLUGIN_INVALID_MIGRATION,
        httpStatus: 422,
        message:    `${filename} contains an unrecognised statement: "${stmt.slice(0, 60)}…". Only DDL statements are permitted.`,
      });
    }

    // Naming guards — a plugin's schema must stay in its own namespace.
    for (const name of extractGovernedNames(stmt)) {
      if (RESERVED_NAME.test(name)) {
        throw new XentiumError({
          code:       XEC.PLUGIN_TABLE_NAMING,
          httpStatus: 422,
          message:    `${filename} targets the reserved object "${name}". Plugin migrations may not create, alter, or drop core objects (names beginning xcf_, ncf_, nodevo_, xentium_, _prisma, pg_, or information_schema).`,
        });
      }
      if (prefix && !name.startsWith(prefix)) {
        throw new XentiumError({
          code:       XEC.PLUGIN_TABLE_NAMING,
          httpStatus: 422,
          message:    `${filename} declares object "${name}", which does not start with this plugin's tablePrefix "${prefix}". Every table, index, sequence, type, function, and trigger a plugin creates must be prefixed "${prefix}".`,
        });
      }
    }
  }
}
