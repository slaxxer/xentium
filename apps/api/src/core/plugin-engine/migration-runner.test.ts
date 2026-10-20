/**
 * The migration runner against the real test database.
 *
 * What must hold: a migration the policy refuses runs nothing; one that fails
 * halfway in Postgres leaves nothing behind (no table, no tracking row); a bad
 * down migration is refused at install time, before anything runs; and up then
 * down puts the schema back the way it was.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import type { PluginManifest } from "@xentium/plugin-engine";
import { XEC } from "@xentium/errors";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { runUpMigrations, runDownMigrations, validateMigrationPairs } = await import("./migration-runner.js");

const PLUGIN = "zz-runner-probe";
const manifest = (migrations: string[]) =>
  ({ id: PLUGIN, version: "1.0.0", migrations, tablePrefix: "zz_" }) as unknown as PluginManifest;

function pkg(files: Record<string, string>): AdmZip {
  const zip = new AdmZip();
  for (const [name, sql] of Object.entries(files)) zip.addFile(`migrations/${name}`, Buffer.from(sql));
  return zip;
}

const tableExists = async (name: string) =>
  (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_tables WHERE tablename = ${name}`)[0]!.n === 1;
const tracked = () => prisma.xentiumPluginMigration.count({ where: { pluginId: PLUGIN } });

async function cleanup() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS zz_a, zz_b CASCADE`);
  await prisma.xentiumPluginMigration.deleteMany({ where: { pluginId: PLUGIN } });
}
beforeEach(async () => { assertDisposableDatabase(); await cleanup(); });
afterEach(cleanup);

describe("plugin migration runner", () => {
  it("runs nothing from a migration the policy refuses", async () => {
    const zip = pkg({ "001.up.sql": `CREATE TABLE zz_a (id int); DELETE FROM xcf_users;`, "001.down.sql": `DROP TABLE zz_a;` });
    await expect(runUpMigrations(zip, manifest(["001"]))).rejects.toMatchObject({ code: XEC.PLUGIN_TABLE_NAMING });
    expect(await tableExists("zz_a")).toBe(false);
    expect(await tracked()).toBe(0);
  });

  it("leaves nothing behind when a statement fails halfway", async () => {
    const zip = pkg({
      "001.up.sql": `CREATE TABLE zz_a (id int); ALTER TABLE zz_missing ADD COLUMN x int;`,
      "001.down.sql": `DROP TABLE IF EXISTS zz_a;`,
    });
    await expect(runUpMigrations(zip, manifest(["001"]))).rejects.toThrow();
    expect(await tableExists("zz_a")).toBe(false);
    expect(await tracked()).toBe(0);
  });

  it("keeps earlier migrations when a later one fails, and tracks only those", async () => {
    const zip = pkg({
      "001.up.sql": `CREATE TABLE zz_a (id int);`, "001.down.sql": `DROP TABLE zz_a;`,
      "002.up.sql": `CREATE TABLE zz_b (id int); ALTER TABLE zz_missing ADD COLUMN x int;`, "002.down.sql": `DROP TABLE zz_b;`,
    });
    await expect(runUpMigrations(zip, manifest(["001", "002"]))).rejects.toThrow();
    expect(await tableExists("zz_a")).toBe(true);
    expect(await tableExists("zz_b")).toBe(false);
    expect(await tracked()).toBe(1);
  });

  it("refuses a bad down migration at install time, before anything runs", async () => {
    const zip = pkg({ "001.up.sql": `CREATE TABLE zz_a (id int);`, "001.down.sql": `DROP TABLE xcf_users;` });
    await expect(validateMigrationPairs(zip, manifest(["001"]))).rejects.toMatchObject({ code: XEC.PLUGIN_TABLE_NAMING });
  });

  it("refuses a plugin with migrations but no tablePrefix", async () => {
    const zip = pkg({ "001.up.sql": `CREATE TABLE zz_a (id int);`, "001.down.sql": `DROP TABLE zz_a;` });
    const noPrefix = { id: PLUGIN, version: "1.0.0", migrations: ["001"] } as unknown as PluginManifest;
    await expect(validateMigrationPairs(zip, noPrefix)).rejects.toMatchObject({ code: XEC.PLUGIN_TABLE_NAMING });
  });

  it("up then down puts the schema back", async () => {
    const zip = pkg({
      "001.up.sql": `CREATE TABLE zz_a (id int PRIMARY KEY); CREATE TABLE zz_b (a_id int REFERENCES zz_a(id));`,
      "001.down.sql": `DROP TABLE zz_b; DROP TABLE zz_a;`,
    });
    await validateMigrationPairs(zip, manifest(["001"]));
    await runUpMigrations(zip, manifest(["001"]));
    expect(await tableExists("zz_a")).toBe(true);
    expect(await tracked()).toBe(1);

    await runDownMigrations(zip, manifest(["001"]));
    expect(await tableExists("zz_a")).toBe(false);
    expect(await tableExists("zz_b")).toBe(false);
    expect(await tracked()).toBe(0);
  });
});
