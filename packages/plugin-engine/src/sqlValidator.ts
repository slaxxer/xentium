import { loadModule, parseSync } from "libpg-query";
import { XentiumError, XEC } from "@xentium/errors";

/**
 * The policy every plugin migration is held to, checked on the real PostgreSQL 17
 * parse tree (libpg-query is Postgres's own parser compiled to wasm).
 *
 * It used to be regular expressions over a hand-written statement splitter, and
 * Postgres and the splitter disagreed: an identifier like `p_x$a$` or a string like
 * `E'\''` hid a `DELETE FROM xcf_users` inside what the splitter took for one
 * CREATE TABLE. Now the statements that run are exactly the ones the parser found,
 * cut from the source at the parser's own offsets, and each is parsed again on its
 * own to make sure it is one statement.
 *
 * What a migration may do: create, alter, rename, comment on and drop its OWN
 * tables, indexes, sequences, types, functions and triggers. Every object name must
 * carry the plugin's tablePrefix, in the public schema, and foreign keys point only
 * at the plugin's own tables. Nothing that reads or writes
 * rows (no subqueries, no CREATE TABLE AS), no calls to the plugin's own functions
 * or to functions that run SQL or reach the server during the migration, and
 * extensions only from a short list, never dropped.
 *
 * What it can't do: police the body of a function. A plugin's functions and its
 * server code run with the site's database rights; installing a plugin means
 * trusting its code. This guard keeps a migration from damaging the site while it
 * runs, and keeps a plugin's schema in its own namespace.
 */

/** Never a plugin's: core tables (xcf_, and ncf_ before the rename), core
 *  bookkeeping (xentium_, nodevo_), Prisma's tables and the system catalogs. */
const RESERVED_NAME = /^(xcf_|ncf_|nodevo_|xentium_|_prisma|pg_|information_schema)/i;

/** Extensions a migration may create (IF NOT EXISTS only). Dropping one never. */
const EXTENSIONS = new Set(["pg_trgm", "citext", "uuid-ossp", "pgcrypto", "unaccent", "btree_gin", "btree_gist", "fuzzystrmatch"]);

/** ALTER TABLE actions on the plugin's own tables. */
const ALTER_TABLE_ACTIONS = new Set([
  "AT_AddColumn", "AT_DropColumn", "AT_ColumnDefault", "AT_SetNotNull", "AT_DropNotNull",
  "AT_AlterColumnType", "AT_AddConstraint", "AT_DropConstraint", "AT_ValidateConstraint",
  "AT_AddIndex", "AT_SetStatistics", "AT_EnableTrig", "AT_DisableTrig",
]);

/** What a DROP / COMMENT / RENAME may name. */
const OWN_OBJECT_TYPES = new Set([
  "OBJECT_TABLE", "OBJECT_INDEX", "OBJECT_SEQUENCE", "OBJECT_TYPE", "OBJECT_FUNCTION",
  "OBJECT_TRIGGER", "OBJECT_COLUMN", "OBJECT_TABCONSTRAINT",
]);

/** Node types that read or write rows, or run code, wherever they appear. */
const FORBIDDEN_NODES = new Set([
  "SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt", "SubLink",
  "CopyStmt", "DoStmt", "CallStmt", "ExecuteStmt",
]);

/** Functions a DEFAULT or CHECK may not call: ones that run SQL from a string, touch
 *  files, other servers or other sessions, or change settings. */
const FORBIDDEN_FUNCTIONS =
  /^(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|cursor_to_xml|cursor_to_xmlschema|table_to_xml|table_to_xmlschema|table_to_xml_and_xmlschema|schema_to_xml|database_to_xml|dblink.*|lo_.*|pg_read_.*|pg_ls_.*|pg_stat_file|pg_file_.*|set_config|setval|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_advisory.*|pg_notify)$/;

const LANGUAGES = new Set(["plpgsql", "sql"]);

/**
 * Naming policy for a plugin's migrations. `tablePrefix` is required once a plugin
 * has migrations: every object it creates must carry it.
 */
export interface MigrationSqlPolicy {
  tablePrefix?: string;
}

type Node = Record<string, unknown>;

let ready: Promise<void> | null = null;
/** The parser is wasm and loads once. */
const parser = () => (ready ??= loadModule());

function invalid(filename: string, message: string): never {
  throw new XentiumError({ code: XEC.PLUGIN_INVALID_MIGRATION, httpStatus: 422, message: `${filename}: ${message}` });
}
function naming(filename: string, message: string): never {
  throw new XentiumError({ code: XEC.PLUGIN_TABLE_NAMING, httpStatus: 422, message: `${filename}: ${message}` });
}

const sval = (n: unknown): string | undefined => ((n as { String?: { sval?: string } })?.String?.sval);
const names = (list: unknown): string[] => (Array.isArray(list) ? list.map(sval).filter((s): s is string => !!s) : []);

/** The name parts of an object reference, whatever shape the parser gave it
 *  (a List of strings, a function with arguments, a type name, or a bare list). */
function objectParts(o: unknown): string[] {
  const obj = o as { List?: { items?: unknown[] }; ObjectWithArgs?: { objname?: unknown[] }; TypeName?: { names?: unknown[] }; objname?: unknown[]; names?: unknown[] };
  if (!obj) return [];
  if (Array.isArray(o)) return names(o);
  if (obj.ObjectWithArgs) return names(obj.ObjectWithArgs.objname);
  if (obj.TypeName) return names(obj.TypeName.names);
  if (obj.List) return names(obj.List.items);
  if (obj.objname) return names(obj.objname);
  if (obj.names) return names(obj.names);
  const single = sval(o);
  return single ? [single] : [];
}

/** The statements of one migration file, exactly as Postgres splits them. */
function parseStatements(sql: string, filename: string): { kind: string; node: Node; text: string }[] {
  let tree: { stmts?: { stmt: Node; stmt_location?: number; stmt_len?: number }[] };
  try {
    tree = parseSync(sql) as typeof tree;
  } catch (err) {
    // Empty or comment-only: a placeholder migration, nothing to run.
    if (err instanceof Error && /cannot be empty/i.test(err.message)) return [];
    invalid(filename, `is not valid SQL (${err instanceof Error ? err.message : String(err)}).`);
  }
  // Offsets are bytes into the UTF-8 source.
  const bytes = Buffer.from(sql, "utf8");
  return (tree.stmts ?? []).map(({ stmt, stmt_location = 0, stmt_len = 0 }) => {
    const kind = Object.keys(stmt)[0]!;
    const end = stmt_len ? stmt_location + stmt_len : bytes.length;
    return { kind, node: stmt[kind] as Node, text: bytes.subarray(stmt_location, end).toString("utf8").trim() };
  });
}

/** Validate a migration and return the statements to run, in order. */
function plan(sql: string, filename: string, policy: MigrationSqlPolicy | undefined): string[] {
  const statements = parseStatements(sql, filename);
  if (statements.length === 0) return [];

  const prefix = policy?.tablePrefix;
  if (!prefix) {
    naming(filename, "a plugin with migrations must declare a tablePrefix in its manifest; every object it creates carries it.");
  }
  if (RESERVED_NAME.test(prefix)) naming(filename, `tablePrefix "${prefix}" is reserved for core.`);

  const own = (name: string | undefined, what: string) => {
    if (!name) return;
    if (RESERVED_NAME.test(name)) {
      naming(filename, `targets the reserved object "${name}". Plugin migrations may not create, alter or drop core objects.`);
    }
    if (!name.startsWith(prefix)) {
      naming(filename, `${what} "${name}" does not start with this plugin's tablePrefix "${prefix}".`);
    }
  };
  /** A qualified name (["public", "x"] or ["x"]): public schema, own last part. */
  const ownQualified = (parts: string[], what: string) => {
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== "public")) {
      naming(filename, `${what} "${parts.join(".")}" is outside the public schema.`);
    }
    own(parts[parts.length - 1], what);
  };

  for (const { kind, node, text } of statements) {
    const where = `"${text.replace(/\s+/g, " ").slice(0, 70)}"`;
    checkTree(node, filename, where, prefix);

    switch (kind) {
      case "CreateStmt":
      case "IndexStmt":
      case "CreateTrigStmt":
      case "CreateSeqStmt":
      case "AlterSeqStmt":
      case "CompositeTypeStmt":
        // Names are RangeVars, all checked by checkTree; plus the plain-string names.
        if (kind === "IndexStmt") own(node.idxname as string | undefined, "index");
        if (kind === "CreateTrigStmt") {
          if (node.isconstraint) invalid(filename, `constraint triggers are not allowed: ${where}.`);
          own(node.trigname as string, "trigger");
          ownQualified(names(node.funcname), "trigger function");
        }
        break;

      case "AlterTableStmt": {
        if (node.objtype !== "OBJECT_TABLE" && node.objtype !== "OBJECT_INDEX") {
          invalid(filename, `only ALTER TABLE and ALTER INDEX are allowed: ${where}.`);
        }
        for (const cmd of (node.cmds as { AlterTableCmd: { subtype: string } }[] | undefined) ?? []) {
          const action = cmd.AlterTableCmd.subtype;
          if (node.objtype === "OBJECT_INDEX" ? action !== "AT_SetStatistics" : !ALTER_TABLE_ACTIONS.has(action)) {
            invalid(filename, `${action.replace(/^AT_/, "")} is not allowed in a plugin migration: ${where}.`);
          }
        }
        break;
      }

      case "RenameStmt": {
        if (!OWN_OBJECT_TYPES.has(node.renameType as string)) {
          invalid(filename, `renaming a ${String(node.renameType).replace(/^OBJECT_/, "").toLowerCase()} is not allowed: ${where}.`);
        }
        const renamesObject = ["OBJECT_TABLE", "OBJECT_INDEX", "OBJECT_SEQUENCE", "OBJECT_TYPE", "OBJECT_FUNCTION", "OBJECT_TRIGGER"]
          .includes(node.renameType as string);
        if (renamesObject) own(node.newname as string, "new name");
        if (node.object) {
          const parts = objectParts(node.object);
          if (parts.length === 0) invalid(filename, `could not tell what is being renamed: ${where}.`);
          ownQualified(parts, "renamed object");
        }
        if (node.renameType === "OBJECT_TRIGGER") own(node.subname as string, "trigger");
        break;
      }

      case "CreateFunctionStmt": {
        ownQualified(names(node.funcname), "function");
        if (node.sql_body) invalid(filename, `BEGIN ATOMIC function bodies are not allowed; use a quoted body: ${where}.`);
        for (const opt of (node.options as { DefElem: { defname: string; arg?: unknown } }[] | undefined) ?? []) {
          const { defname, arg } = opt.DefElem;
          if (defname === "language" && !LANGUAGES.has(sval(arg) ?? "")) {
            invalid(filename, `functions must be LANGUAGE plpgsql or sql: ${where}.`);
          }
          if (defname === "security" && (arg as { Boolean?: { boolval?: boolean } })?.Boolean?.boolval) {
            invalid(filename, `SECURITY DEFINER functions are not allowed: ${where}.`);
          }
        }
        break;
      }

      case "DropStmt": {
        const type = node.removeType as string;
        if (!OWN_OBJECT_TYPES.has(type) || type === "OBJECT_COLUMN" || type === "OBJECT_TABCONSTRAINT") {
          invalid(filename, `dropping a ${type.replace(/^OBJECT_/, "").toLowerCase()} is not allowed: ${where}.`);
        }
        for (const obj of (node.objects as unknown[] | undefined) ?? []) {
          const parts = objectParts(obj);
          if (parts.length === 0) invalid(filename, `could not tell what is being dropped: ${where}.`);
          if (type === "OBJECT_TRIGGER") {
            // [table…, trigger]: both the plugin's.
            ownQualified(parts.slice(0, -1), "table");
            own(parts[parts.length - 1], "trigger");
          } else {
            ownQualified(parts, type.replace(/^OBJECT_/, "").toLowerCase());
          }
        }
        break;
      }

      case "CommentStmt": {
        const type = node.objtype as string;
        if (!OWN_OBJECT_TYPES.has(type)) invalid(filename, `comments are allowed on the plugin's own objects only: ${where}.`);
        let parts = objectParts(node.object);
        if (parts.length === 0) invalid(filename, `could not tell what is being commented on: ${where}.`);
        if (type === "OBJECT_COLUMN" || type === "OBJECT_TABCONSTRAINT" || type === "OBJECT_TRIGGER") parts = parts.slice(0, -1);
        ownQualified(parts, "commented object");
        break;
      }

      case "CreateEnumStmt":
      case "AlterEnumStmt":
        ownQualified(names(node.typeName), "type");
        break;

      case "CreateExtensionStmt":
        if (!EXTENSIONS.has(node.extname as string)) {
          invalid(filename, `extension "${String(node.extname)}" is not on the allowed list (${[...EXTENSIONS].join(", ")}).`);
        }
        if (!node.if_not_exists) invalid(filename, `use CREATE EXTENSION IF NOT EXISTS: ${where}.`);
        if (node.options) invalid(filename, `CREATE EXTENSION takes no options in a plugin migration: ${where}.`);
        break;

      default:
        invalid(filename, `${kind.replace(/Stmt$/, "")} statements are not allowed in a plugin migration: ${where}. Only DDL on the plugin's own objects is.`);
    }

    // Belt and braces: the text we will run must parse back to this one statement.
    const again = parseStatements(text, filename);
    if (again.length !== 1 || again[0]!.kind !== kind) invalid(filename, `could not isolate the statement ${where}.`);
  }
  return statements.map((s) => s.text);
}

/**
 * Checks that hold anywhere in a statement's tree: no node that reads or writes
 * rows, every relation (foreign key targets included) in the public schema and the
 * plugin's own, and no function call that would run code now.
 */
function checkTree(root: unknown, filename: string, where: string, prefix: string): void {
  const visit = (n: unknown, underFkTarget: boolean): void => {
    if (Array.isArray(n)) { n.forEach((x) => visit(x, underFkTarget)); return; }
    if (!n || typeof n !== "object") return;
    for (const [key, value] of Object.entries(n as Node)) {
      if (FORBIDDEN_NODES.has(key)) {
        invalid(filename, `reads or writes rows (${key.replace(/Stmt$/, "")}); migrations are DDL only: ${where}.`);
      }
      if (key === "RangeVar") {
        const rv = value as { relname?: string; schemaname?: string; catalogname?: string };
        if (rv.catalogname || (rv.schemaname && rv.schemaname !== "public")) {
          naming(filename, `"${[rv.schemaname, rv.relname].filter(Boolean).join(".")}" is outside the public schema: ${where}.`);
        }
        const name = rv.relname ?? "";
        if (underFkTarget && !name.startsWith(prefix)) {
          // Core's Prisma migrations don't know plugin tables exist, so a foreign key
          // into core would block them (and deleting a member). Store the id instead.
          naming(filename, `a foreign key may only reference this plugin's own tables, not "${name}"; store the id and clean up in onUserDeactivated: ${where}.`);
        }
        if (RESERVED_NAME.test(name)) naming(filename, `targets the reserved object "${name}". Plugin migrations may not create, alter or drop core objects.`);
        if (!name.startsWith(prefix)) naming(filename, `"${name}" does not start with this plugin's tablePrefix "${prefix}": ${where}.`);
        continue;
      }
      if (key === "FuncCall") {
        const parts = names((value as { funcname?: unknown[] }).funcname);
        const fn = parts[parts.length - 1] ?? "";
        if (parts.length > 1 && !["pg_catalog", "public"].includes(parts[0]!)) {
          invalid(filename, `calls "${parts.join(".")}" outside the public schema: ${where}.`);
        }
        if (fn.startsWith(prefix)) {
          invalid(filename, `calls the plugin's own function "${fn}" while migrating; that runs plugin code against the site's data: ${where}.`);
        }
        if (FORBIDDEN_FUNCTIONS.test(fn)) invalid(filename, `calls "${fn}", which is not allowed in a migration: ${where}.`);
        if (fn === "nextval" || fn === "currval") {
          // Only the plugin's own sequences: nextval('xcf_…') would advance core's.
          const seq = JSON.stringify((value as { args?: unknown }).args ?? "").match(/"sval":"([^"]*)"/)?.[1] ?? "";
          const seqName = seq.split(".").pop()!.replace(/"/g, "");
          if (!seqName.startsWith(prefix)) invalid(filename, `${fn}('${seq}') names a sequence that isn't this plugin's: ${where}.`);
        }
      }
      if (key === "Constraint") {
        const c = value as Node & { pktable?: unknown };
        const { pktable, ...rest } = c;
        visit(rest, underFkTarget);
        if (pktable) visit({ RangeVar: pktable }, true);
        continue;
      }
      // `relation` and friends hold a bare RangeVar body, without the wrapper key.
      if (["relation", "sequence", "typevar"].includes(key) && value && typeof value === "object" && "relname" in (value as Node)) {
        visit({ RangeVar: value }, underFkTarget);
        continue;
      }
      if (key === "inhRelations") {
        invalid(filename, `INHERITS is not allowed in a plugin migration: ${where}.`);
      }
      visit(value, underFkTarget);
    }
  };
  visit(root, false);
}

/**
 * Validate a migration and return the statements to run, cut at the parser's own
 * boundaries. Run these, never a re-split of the source.
 */
export async function planMigrationSql(sql: string, filename: string, policy?: MigrationSqlPolicy): Promise<string[]> {
  await parser();
  return plan(sql, filename, policy);
}

/** Throw unless the migration passes the policy. */
export async function validateMigrationSql(sql: string, filename: string, policy?: MigrationSqlPolicy): Promise<void> {
  await planMigrationSql(sql, filename, policy);
}
