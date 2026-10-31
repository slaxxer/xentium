/**
 * `host.pg`: a plugin that brings its own database client runs it on core's pool —
 * the same pool core's Prisma uses, not a second one — and its own client works on it.
 */
import { describe, expect, it } from "vitest";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { pool, PrismaClient } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { PluginContextImpl } from "./plugin-context.js";

describe("plugin host: the connection pool", () => {
  it("hands a plugin core's own pool", () => {
    const ctx = new PluginContextImpl("pool-probe");
    expect(ctx.host.pg).toBe(pool);
    expect(ctx.host.pg).toBeInstanceOf(pg.Pool);
  });

  it("runs a plugin's own Prisma client and plain queries on it", async () => {
    assertDisposableDatabase();
    const host = new PluginContextImpl("pool-probe").host;
    const own = new PrismaClient({ adapter: new PrismaPg(host.pg as pg.Pool) });
    const [row] = await own.$queryRawUnsafe<{ n: number }[]>("SELECT 41 + 1 AS n");
    expect(Number(row!.n)).toBe(42);
    const plain = await (host.pg as pg.Pool).query<{ ok: boolean }>("SELECT true AS ok");
    expect(plain.rows[0]!.ok).toBe(true);
  });
});
