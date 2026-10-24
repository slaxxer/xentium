import crypto from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { XEC, buildPaginationMeta } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";
import type { PluginResourceDeclaration, ResourceAccess, ResourceHookContext } from "@xentium/plugin-sdk";
import { prisma } from "../../infrastructure/db.js";
import { optionalAuth, unauthenticatedError } from "../../shared/middleware/requireAuth.js";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { emitAny } from "../events/events.js";
import { pluginRouter } from "../plugin-engine/plugin-router.js";

/**
 * Resources (ADR-0011): a plugin describes its data — a table it created, a schema,
 * who may do what — and core serves the endpoints at `/api/p/<pluginId>/<name>`:
 *
 *   GET    /<name>               list: ?page&limit&sort=field|-field&<field>=value&q=…&deleted=1
 *   GET    /<name>/:id           read one
 *   POST   /<name>               create (owner = the caller)
 *   PATCH  /<name>/:id           update some fields
 *   DELETE /<name>/:id           delete (soft when softDelete)
 *   POST   /<name>/:id/restore   undo a soft delete (managers)
 *
 * with Zod validation (XEC-API-4001), permission and ownership checks, pagination,
 * and events (`<pluginId>.<name>.created|updated|deleted|restored`, payload
 * `{ id, userId }`) — a plugin that wants an audit trail listens to those.
 *
 * Safety: core reaches the plugin's table only on its behalf. The table must carry
 * the plugin's `tablePrefix`; at enable, every column the declaration names is
 * looked up in the database, and only those names (quoted, from that check) ever
 * reach SQL. Values always travel as parameters, cast to the column's own type.
 */

type Row = Record<string, unknown>;
interface Column { name: string; cast: string | null }
interface Compiled {
  pluginId: string;
  decl: PluginResourceDeclaration<z.ZodObject<Record<string, z.ZodType>>>;
  table: string;
  id: Column;
  owner: Column | null;
  fields: Map<string, Column>;          // schema field → column
  created: Column | null;
  updated: Column | null;
  deleted: Column | null;
  shape: Record<string, z.ZodType>;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_LIMIT = 100;
/** Postgres types a parameter is cast to; anything else is passed as is. */
const CASTS: Record<string, string> = {
  text: "text", varchar: "text", bpchar: "text", uuid: "uuid",
  int2: "int2", int4: "int4", int8: "int8", numeric: "numeric", float4: "float4", float8: "float8",
  bool: "boolean", date: "date", timestamp: "timestamp", timestamptz: "timestamptz",
  json: "json", jsonb: "jsonb",
};

const registry = new Map<string, Map<string, Compiled>>();

const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const q = (ident: string) => `"${ident}"`;

function fail(pluginId: string, message: string): never {
  throw new Error(`[plugin resources] ${pluginId}: ${message}`);
}

function isZodObject(v: unknown): v is z.ZodObject<Record<string, z.ZodType>> {
  return !!v && typeof v === "object" && "shape" in v && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

/** Check a declaration against the database and remember it. Throws — failing the enable — when anything does not fit. */
export async function registerResource(pluginId: string, tablePrefix: string | undefined, input: PluginResourceDeclaration): Promise<void> {
  const decl = input as Compiled["decl"];
  if (!NAME.test(decl.name)) fail(pluginId, `"${decl.name}" is not a resource name (a-z, 0-9, -; up to 40).`);
  if (!isZodObject(decl.schema)) fail(pluginId, `resource "${decl.name}": "schema" must be a Zod object.`);
  if (!tablePrefix) fail(pluginId, `resource "${decl.name}": the plugin must declare a tablePrefix to use resources.`);
  if (!IDENT.test(decl.table) || !decl.table.startsWith(tablePrefix)) {
    fail(pluginId, `resource "${decl.name}": table "${decl.table}" must be one of this plugin's tables (prefix "${tablePrefix}").`);
  }
  for (const k of ["create", "update", "delete"] as const) {
    if (decl.access[k] === "public") fail(pluginId, `resource "${decl.name}": only signed-in members may ${k}; "public" is for reading.`);
  }
  if ((decl.access.update === "own" || decl.access.delete === "own" || decl.access.read === "own") && !decl.owner) {
    fail(pluginId, `resource "${decl.name}": "own" needs an owner column.`);
  }

  const cols = await prisma.$queryRaw<Array<{ column_name: string; udt_name: string }>>`
    SELECT column_name, udt_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ${decl.table}`;
  if (!cols.length) fail(pluginId, `resource "${decl.name}": table "${decl.table}" does not exist (create it in a migration).`);
  const byName = new Map(cols.map((c) => [c.column_name, c.udt_name]));
  const col = (name: string, what: string): Column => {
    if (!IDENT.test(name) || !byName.has(name)) fail(pluginId, `resource "${decl.name}": ${what} column "${name}" is not in "${decl.table}".`);
    return { name, cast: CASTS[byName.get(name)!] ?? null };
  };
  const maybe = (name: string) => (byName.has(name) ? col(name, name) : null);

  const shape = decl.schema.shape;
  const fields = new Map<string, Column>();
  for (const key of Object.keys(shape)) {
    fields.set(key, col(decl.columns?.[key] ?? snake(key), `field "${key}"'s`));
  }
  const timestamps = decl.timestamps !== false;
  const compiled: Compiled = {
    pluginId, decl, table: decl.table, shape,
    id: col(decl.idColumn ?? "id", "id"),
    owner: decl.owner ? col(decl.owner, "owner") : null,
    fields,
    created: timestamps ? col("created_at", "created_at") : null,
    updated: timestamps ? maybe("updated_at") : null,
    deleted: decl.softDelete ? col("deleted_at", "deleted_at") : null,
  };
  for (const list of [decl.sort, decl.filter, decl.search]) {
    for (const f of list ?? []) {
      if (!fields.has(f) && !(f === "createdAt" && compiled.created)) fail(pluginId, `resource "${decl.name}": "${f}" is not a field.`);
    }
  }

  let mine = registry.get(pluginId);
  if (!mine) registry.set(pluginId, (mine = new Map()));
  mine.set(decl.name, compiled);
  pluginRouter.register(pluginId, buildRouter(pluginId), "resources");
}

/** Forget a plugin's resources in this process (disable, update). */
export function deregisterResources(pluginId: string): void {
  registry.delete(pluginId);
}

// ── SQL ─────────────────────────────────────────────────────────────────────

function param(params: unknown[], value: unknown, c: Column): string {
  const v = value instanceof Date || value === null || typeof value !== "object" ? value : JSON.stringify(value);
  params.push(v === undefined ? null : v);
  return `$${params.length}${c.cast ? `::${c.cast}` : ""}`;
}

function selectList(r: Compiled): string {
  const parts = [`${q(r.id.name)} AS "__id"`];
  for (const [k, c] of r.fields) parts.push(`${q(c.name)} AS ${q(`f_${k}`)}`);
  if (r.owner) parts.push(`${q(r.owner.name)} AS "__owner"`);
  if (r.created) parts.push(`${q(r.created.name)} AS "__created"`);
  if (r.updated) parts.push(`${q(r.updated.name)} AS "__updated"`);
  if (r.deleted) parts.push(`${q(r.deleted.name)} AS "__deleted"`);
  return parts.join(", ");
}

/** A database value as JSON can carry it. */
function out(v: unknown): unknown {
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function" && !(v instanceof Date)) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return v;
}

function shapeRow(r: Compiled, raw: Row, manager: boolean): Row {
  const row: Row = { id: out(raw.__id) };
  for (const k of r.fields.keys()) row[k] = out(raw[`f_${k}`]);
  if (r.owner) row.ownerId = out(raw.__owner);
  if (r.created) row.createdAt = raw.__created;
  if (r.updated) row.updatedAt = raw.__updated;
  if (r.deleted && manager) row.deletedAt = raw.__deleted ?? null;
  return row;
}

async function findRow(r: Compiled, id: string, withDeleted: boolean): Promise<Row | null> {
  const params: unknown[] = [];
  const where = [`${q(r.id.name)} = ${param(params, id, r.id)}`];
  if (r.deleted && !withDeleted) where.push(`${q(r.deleted.name)} IS NULL`);
  const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT ${selectList(r)} FROM ${q(r.table)} WHERE ${where.join(" AND ")} LIMIT 1`, ...params);
  return rows[0] ?? null;
}

// ── Access ──────────────────────────────────────────────────────────────────

async function may(userId: string | undefined, rule: ResourceAccess | undefined): Promise<boolean> {
  if (!rule || rule === "public") return true;
  if (!userId) return false;
  if (rule === "members" || rule === "own") return true;
  return hasPermission(userId, rule as never);
}

async function isManager(r: Compiled, userId: string | undefined): Promise<boolean> {
  return !!userId && !!r.decl.access.manage && hasPermission(userId, r.decl.access.manage as never);
}

function denied(): never {
  throw new XentiumError({ code: XEC.PERM_DENIED, httpStatus: 403, message: "Not allowed" });
}
function notFound(): never {
  throw new XentiumError({ code: XEC.API_NOT_FOUND, httpStatus: 404, message: "Not found" });
}
function needsSignIn(userId: string | undefined): asserts userId is string {
  if (!userId) throw unauthenticatedError();
}

/** "own": the owner, or a manager. A rule: whoever holds it. */
async function mayOnRow(r: Compiled, rule: ResourceAccess, userId: string, row: Row): Promise<boolean> {
  if (await isManager(r, userId)) return true;
  if (rule === "own") return row.__owner === userId;
  return may(userId, rule);
}

// ── The router ──────────────────────────────────────────────────────────────

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  sort: z.string().max(64).optional(),
  q: z.string().trim().max(200).optional(),
  deleted: z.enum(["0", "1"]).optional(),
}).passthrough();
const idParam = z.object({ id: z.string().min(1).max(128) });

function hookCtx(req: Request): ResourceHookContext {
  const userId = req.userId ?? null;
  return { userId, can: (perm: string) => (userId ? hasPermission(userId, perm as never) : Promise.resolve(false)) };
}

function eventName(r: Compiled, what: string): string {
  return `${r.pluginId}.${r.decl.name}.${what}`;
}

function resource(pluginId: string, name: string): Compiled {
  const r = registry.get(pluginId)?.get(name);
  if (!r) notFound();
  return r;
}

/** Strict: unknown keys are refused, not dropped, so a typo is an error the client sees. */
function parseBody(r: Compiled, body: unknown, partial: boolean): Row {
  const schema = (partial ? r.decl.schema.partial() : r.decl.schema).strict();
  const parsed = schema.parse(body ?? {}) as Row;
  if (!partial) return parsed;
  // ⚠ A partial schema still fills in defaults: an update must change only the
  // fields it sent, or editing a title would reset the body to its default.
  const sent = body && typeof body === "object" ? Object.keys(body) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.includes(k)));
}

function buildRouter(pluginId: string): Router {
  const router = Router();
  router.use(optionalAuth);

  router.get("/:name", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    const userId = req.userId;
    const manager = await isManager(r, userId);
    if (!manager && !(await may(userId, r.decl.access.read))) denied();
    const qy = listQuery.parse(req.query);

    const params: unknown[] = [];
    const where: string[] = [];
    if (r.deleted && !(manager && qy.deleted === "1")) where.push(`${q(r.deleted.name)} IS NULL`);
    if (r.decl.access.read === "own" && !manager) {
      needsSignIn(userId);
      where.push(`${q(r.owner!.name)} = ${param(params, userId, r.owner!)}`);
    }
    for (const f of r.decl.filter ?? []) {
      const v = (req.query as Record<string, unknown>)[f];
      if (typeof v === "string" && v !== "") {
        const c = r.fields.get(f)!;
        where.push(`${q(c.name)}::text = $${params.push(v)}`);
      }
    }
    if (qy.q && r.decl.search?.length) {
      const n = params.push(`%${qy.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(${r.decl.search.map((f) => `${q(r.fields.get(f)!.name)}::text ILIKE $${n}`).join(" OR ")})`);
    }
    const sortable = new Set([...(r.decl.sort ?? []), ...(r.created ? ["createdAt"] : [])]);
    const sortKey = qy.sort ?? r.decl.defaultSort ?? (r.created ? "-createdAt" : undefined);
    let order = `${q(r.id.name)} ASC`;
    if (sortKey) {
      const desc = sortKey.startsWith("-");
      const f = desc ? sortKey.slice(1) : sortKey;
      if (!sortable.has(f)) throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 400, message: `Cannot sort by "${f}"` });
      const c = f === "createdAt" ? r.created! : r.fields.get(f)!;
      order = `${q(c.name)} ${desc ? "DESC" : "ASC"}, ${q(r.id.name)} ASC`;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows, count] = await Promise.all([
      prisma.$queryRawUnsafe<Row[]>(
        `SELECT ${selectList(r)} FROM ${q(r.table)} ${whereSql} ORDER BY ${order} LIMIT ${qy.limit} OFFSET ${(qy.page - 1) * qy.limit}`, ...params),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${q(r.table)} ${whereSql}`, ...params),
    ]);
    res.json({
      data: rows.map((row) => shapeRow(r, row, manager)),
      meta: buildPaginationMeta({ page: qy.page, limit: qy.limit, total: Number(count[0]?.n ?? 0) }),
    });
  }) as RequestHandler);

  router.get("/:name/:id", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    const { id } = idParam.parse(req.params);
    const userId = req.userId;
    const manager = await isManager(r, userId);
    const row = await findRow(r, id, manager);
    if (!row) notFound();
    const readable = manager || (r.decl.access.read === "own" ? !!userId && row.__owner === userId : await may(userId, r.decl.access.read));
    if (!readable) notFound();   // not 403: someone else's private row does not exist for this viewer
    res.json(shapeRow(r, row, manager));
  }) as RequestHandler);

  router.post("/:name", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    const userId = req.userId;
    needsSignIn(userId);
    if (!(await isManager(r, userId)) && !(await may(userId, r.decl.access.create))) denied();
    let data = parseBody(r, req.body, false);
    const ctx = hookCtx(req);
    const changed = await r.decl.hooks?.beforeCreate?.(data, ctx);
    if (changed) data = parseBody(r, changed, false);

    const params: unknown[] = [];
    const id = crypto.randomUUID();
    const cols = [q(r.id.name)];
    const vals = [param(params, id, r.id)];
    for (const [k, v] of Object.entries(data)) {
      const c = r.fields.get(k)!;
      cols.push(q(c.name)); vals.push(param(params, v, c));
    }
    if (r.owner) { cols.push(q(r.owner.name)); vals.push(param(params, userId, r.owner)); }
    if (r.created) { cols.push(q(r.created.name)); vals.push("now()"); }
    if (r.updated) { cols.push(q(r.updated.name)); vals.push("now()"); }
    await prisma.$executeRawUnsafe(`INSERT INTO ${q(r.table)} (${cols.join(", ")}) VALUES (${vals.join(", ")})`, ...params);

    const row = shapeRow(r, (await findRow(r, id, true))!, false);
    await r.decl.hooks?.afterCreate?.(row, ctx);
    emitAny(eventName(r, "created"), { id, userId });
    res.status(201).json(row);
  }) as RequestHandler);

  router.patch("/:name/:id", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    const { id } = idParam.parse(req.params);
    const userId = req.userId;
    needsSignIn(userId);
    const existing = await findRow(r, id, false);
    if (!existing) notFound();
    if (!(await mayOnRow(r, r.decl.access.update, userId, existing))) denied();
    let patch = parseBody(r, req.body, true);
    const ctx = hookCtx(req);
    const before = shapeRow(r, existing, false);
    const changed = await r.decl.hooks?.beforeUpdate?.(patch, before, ctx);
    if (changed) patch = parseBody(r, changed, true);

    const params: unknown[] = [];
    const sets = Object.entries(patch).map(([k, v]) => `${q(r.fields.get(k)!.name)} = ${param(params, v, r.fields.get(k)!)}`);
    if (r.updated) sets.push(`${q(r.updated.name)} = now()`);
    if (sets.length) {
      await prisma.$executeRawUnsafe(`UPDATE ${q(r.table)} SET ${sets.join(", ")} WHERE ${q(r.id.name)} = ${param(params, id, r.id)}`, ...params);
    }
    const row = shapeRow(r, (await findRow(r, id, true))!, false);
    await r.decl.hooks?.afterUpdate?.(row, ctx);
    emitAny(eventName(r, "updated"), { id, userId, fields: Object.keys(patch) });
    res.json(row);
  }) as RequestHandler);

  router.delete("/:name/:id", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    const { id } = idParam.parse(req.params);
    const userId = req.userId;
    needsSignIn(userId);
    const existing = await findRow(r, id, false);
    if (!existing) notFound();
    if (!(await mayOnRow(r, r.decl.access.delete, userId, existing))) denied();
    const ctx = hookCtx(req);
    const row = shapeRow(r, existing, false);
    await r.decl.hooks?.beforeDelete?.(row, ctx);
    const params: unknown[] = [];
    if (r.deleted) {
      await prisma.$executeRawUnsafe(`UPDATE ${q(r.table)} SET ${q(r.deleted.name)} = now() WHERE ${q(r.id.name)} = ${param(params, id, r.id)}`, ...params);
    } else {
      await prisma.$executeRawUnsafe(`DELETE FROM ${q(r.table)} WHERE ${q(r.id.name)} = ${param(params, id, r.id)}`, ...params);
    }
    await r.decl.hooks?.afterDelete?.(row, ctx);
    emitAny(eventName(r, "deleted"), { id, userId });
    res.status(204).end();
  }) as RequestHandler);

  router.post("/:name/:id/restore", (async (req, res, next) => {
    const r = registry.get(pluginId)?.get(String(req.params.name));
    if (!r) return next();
    if (!r.deleted) return next();
    const { id } = idParam.parse(req.params);
    const userId = req.userId;
    needsSignIn(userId);
    if (!(await isManager(r, userId))) denied();
    const params: unknown[] = [];
    const n = await prisma.$executeRawUnsafe(
      `UPDATE ${q(r.table)} SET ${q(r.deleted.name)} = NULL WHERE ${q(r.id.name)} = ${param(params, id, r.id)} AND ${q(r.deleted.name)} IS NOT NULL`, ...params);
    if (!n) notFound();
    emitAny(eventName(r, "restored"), { id, userId });
    res.json(shapeRow(r, (await findRow(r, id, true))!, true));
  }) as RequestHandler);

  return router;
}

/** For tests. */
export function _resetResources(): void {
  registry.clear();
}
export { resource as _resource };
