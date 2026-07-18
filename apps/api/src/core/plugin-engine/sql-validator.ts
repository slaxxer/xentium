import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
// Validates that a plugin migration SQL file contains only DDL statements.
// Rejects any DML (INSERT/UPDATE/DELETE/SELECT/TRUNCATE/COPY) or anything else.
// Returns true if valid, throws with a descriptive message if not.

const ALLOWED_DDL =
  /^\s*(CREATE(\s+OR\s+REPLACE)?|ALTER|DROP|COMMENT)\s+(TABLE|INDEX|UNIQUE\s+INDEX|SEQUENCE|TYPE|EXTENSION|FUNCTION|TRIGGER)\b/i;
const DISALLOWED = /^\s*(INSERT|UPDATE|DELETE|SELECT|TRUNCATE|COPY|MERGE|CALL|EXEC|GRANT|REVOKE|LOCK)\b/i;

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

export function validateMigrationSql(sql: string, filename: string): void {
  if (!sql.trim()) return;

  // IMPORTANT: split with the SAME quote-/dollar-/comment-aware tokenizer the
  // runner uses (migration-runner.ts), so the validator and executor can never
  // disagree on statement boundaries. The previous regex comment-strip ran
  // BEFORE the split and treated `--` inside a 'string literal' as a comment,
  // letting a smuggled trailing DML statement bypass this DDL-only allowlist.
  for (const rawStmt of splitSqlStatements(sql)) {
    const stmt = leadingKeyword(rawStmt);
    if (!stmt) continue; // comment-only / empty
    if (DISALLOWED.test(stmt)) {
      throw new NodevoError({
        code:       NEC.PLUGIN_INVALID_MIGRATION,
        httpStatus: 422,
        message:    `${filename} contains a disallowed statement: "${stmt.slice(0, 60)}…". Only DDL (CREATE/ALTER/DROP TABLE/INDEX/FUNCTION/TRIGGER) is permitted in plugin migrations.`,
      });
    }
    if (!ALLOWED_DDL.test(stmt)) {
      throw new NodevoError({
        code:       NEC.PLUGIN_INVALID_MIGRATION,
        httpStatus: 422,
        message:    `${filename} contains an unrecognised statement: "${stmt.slice(0, 60)}…". Only DDL statements are permitted.`,
      });
    }
  }
}
