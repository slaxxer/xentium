import { describe, it, expect } from "vitest";
import { validateMigrationSql } from "./sqlValidator.js";
import { XentiumError, NEC } from "@xentium/errors";

/** Assert the call throws a XentiumError carrying the given NEC code. */
function expectNec(fn: () => void, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(XentiumError);
    expect((err as XentiumError).code).toBe(code);
    return;
  }
  throw new Error(`expected a throw with code ${code}, but nothing was thrown`);
}

describe("validateMigrationSql — DDL-only allowlist (unchanged behaviour)", () => {
  it("accepts a plain CREATE TABLE", () => {
    expect(() => validateMigrationSql(`CREATE TABLE sb_rooms (id text primary key);`, "f")).not.toThrow();
  });

  it("rejects DML (INSERT)", () => {
    expectNec(() => validateMigrationSql(`INSERT INTO sb_rooms VALUES ('x');`, "f"), NEC.PLUGIN_INVALID_MIGRATION);
  });

  it("rejects an unrecognised leading statement", () => {
    expectNec(() => validateMigrationSql(`VACUUM sb_rooms;`, "f"), NEC.PLUGIN_INVALID_MIGRATION);
  });

  it("empty / comment-only SQL is a no-op", () => {
    expect(() => validateMigrationSql(`-- just a comment\n`, "f")).not.toThrow();
    expect(() => validateMigrationSql(``, "f")).not.toThrow();
  });
});

describe("validateMigrationSql — reserved namespace (always enforced)", () => {
  it("blocks CREATE TABLE in the ncf_ core namespace", () => {
    expectNec(() => validateMigrationSql(`CREATE TABLE ncf_users (id text);`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks ALTER TABLE on a core table", () => {
    expectNec(() => validateMigrationSql(`ALTER TABLE ncf_users ADD COLUMN evil text;`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks DROP TABLE of core bookkeeping (xentium_, the post-rename prefix)", () => {
    expectNec(() => validateMigrationSql(`DROP TABLE xentium_plugin_migrations;`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks DROP TABLE of core bookkeeping (nodevo_, the pre-rename prefix)", () => {
    expectNec(() => validateMigrationSql(`DROP TABLE nodevo_plugin_migrations;`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks an index created ON a core table", () => {
    expectNec(() => validateMigrationSql(`CREATE INDEX ncf_users_evil ON ncf_users(email);`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks schema-qualified core targets", () => {
    expectNec(() => validateMigrationSql(`CREATE TABLE public.ncf_users (id text);`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("blocks Prisma's internal table", () => {
    expectNec(() => validateMigrationSql(`DROP TABLE _prisma_migrations;`, "f"), NEC.PLUGIN_TABLE_NAMING);
  });

  it("allows a normal, non-reserved table when no prefix policy is declared", () => {
    expect(() => validateMigrationSql(`CREATE TABLE sb_rooms (id text);`, "f")).not.toThrow();
  });
});

describe("validateMigrationSql — declared tablePrefix", () => {
  const policy = { tablePrefix: "sb_" };

  it("accepts objects that carry the prefix", () => {
    const sql = `
      CREATE TABLE sb_rooms (id text primary key);
      CREATE UNIQUE INDEX sb_rooms_order_idx ON sb_rooms(display_order);
      ALTER TABLE sb_rooms ADD COLUMN topic text;
      CREATE SEQUENCE sb_rooms_seq;
    `;
    expect(() => validateMigrationSql(sql, "f", policy)).not.toThrow();
  });

  it("rejects a created table missing the prefix", () => {
    expectNec(() => validateMigrationSql(`CREATE TABLE rooms (id text);`, "f", policy), NEC.PLUGIN_TABLE_NAMING);
  });

  it("rejects an index whose NAME lacks the prefix (even on a prefixed table)", () => {
    expectNec(() => validateMigrationSql(`CREATE INDEX rooms_idx ON sb_rooms(id);`, "f", policy), NEC.PLUGIN_TABLE_NAMING);
  });

  it("rejects indexing a table outside the plugin's namespace", () => {
    expectNec(() => validateMigrationSql(`CREATE INDEX sb_x ON other_rooms(id);`, "f", policy), NEC.PLUGIN_TABLE_NAMING);
  });

  it("a column DEFAULT literal that looks reserved does not trip the guard", () => {
    // The literal 'ncf_x' is column data, not an object name.
    expect(() => validateMigrationSql(`CREATE TABLE sb_rooms (kind text DEFAULT 'ncf_x');`, "f", policy)).not.toThrow();
  });
});

describe("validateMigrationSql — functions, triggers, exemptions", () => {
  const policy = { tablePrefix: "forum_" };

  it("accepts a prefixed function + trigger on a prefixed table", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION forum_thread_search_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('simple', NEW.title);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER forum_thread_search_vector_update
        BEFORE INSERT OR UPDATE ON forum_threads
        FOR EACH ROW EXECUTE FUNCTION forum_thread_search_update();
    `;
    expect(() => validateMigrationSql(sql, "f", policy)).not.toThrow();
  });

  it("blocks a trigger attached to a core table", () => {
    const sql = `CREATE TRIGGER forum_spy BEFORE INSERT ON ncf_users FOR EACH ROW EXECUTE FUNCTION forum_thread_search_update();`;
    expectNec(() => validateMigrationSql(sql, "f", policy), NEC.PLUGIN_TABLE_NAMING);
  });

  it("CREATE EXTENSION is exempt from the prefix rule and does not trip pg_", () => {
    expect(() => validateMigrationSql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`, "f", policy)).not.toThrow();
  });

  it("COMMENT ON is exempt from naming checks (though the DDL allowlist rejects it anyway)", () => {
    // The naming guard treats COMMENT as governing no plugin object; the failure
    // here comes from the pre-existing DDL allowlist (`COMMENT ON …` is not in
    // the supported set), NOT from a naming violation.
    expectNec(() => validateMigrationSql(`COMMENT ON TABLE ncf_users IS 'x';`, "f", policy), NEC.PLUGIN_INVALID_MIGRATION);
  });
});
