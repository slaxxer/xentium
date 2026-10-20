import { describe, it, expect } from "vitest";
import { planMigrationSql, validateMigrationSql } from "./sqlValidator.js";
import { XentiumError, XEC } from "@xentium/errors";

const P = { tablePrefix: "sb_" };

/** Assert the migration is refused with the given XEC code. */
async function refused(sql: string, code: string, policy: { tablePrefix?: string } = P): Promise<void> {
  try {
    await validateMigrationSql(sql, "f.up.sql", policy);
  } catch (err) {
    expect(err).toBeInstanceOf(XentiumError);
    expect((err as XentiumError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} for: ${sql}`);
}
const accepted = (sql: string, policy: { tablePrefix?: string } = P) =>
  expect(validateMigrationSql(sql, "f.up.sql", policy)).resolves.toBeUndefined();

const INVALID = XEC.PLUGIN_INVALID_MIGRATION;
const NAMING = XEC.PLUGIN_TABLE_NAMING;

describe("planMigrationSql: statements are cut by Postgres's own parser", () => {
  it("returns each statement exactly as written, without the semicolons", async () => {
    const stmts = await planMigrationSql(
      `CREATE TABLE sb_rooms (id text primary key);\nCREATE INDEX sb_rooms_id ON sb_rooms (id);`, "f", P);
    expect(stmts).toEqual(["CREATE TABLE sb_rooms (id text primary key)", "CREATE INDEX sb_rooms_id ON sb_rooms (id)"]);
  });

  it("keeps a function body with semicolons as one statement", async () => {
    const stmts = await planMigrationSql(
      `CREATE FUNCTION sb_f() RETURNS trigger AS $body$ BEGIN NEW.a := 1; RETURN NEW; END $body$ LANGUAGE plpgsql;`, "f", P);
    expect(stmts).toHaveLength(1);
  });

  it("cuts correctly around multi-byte characters", async () => {
    const stmts = await planMigrationSql(`COMMENT ON TABLE sb_rooms IS 'Räume für Gäste ✓'; DROP TABLE sb_rooms;`, "f", P);
    expect(stmts).toEqual(["COMMENT ON TABLE sb_rooms IS 'Räume für Gäste ✓'", "DROP TABLE sb_rooms"]);
  });

  it("empty and comment-only migrations run nothing (and need no prefix)", async () => {
    expect(await planMigrationSql(`-- nothing yet\n/* really */`, "f", {})).toEqual([]);
    expect(await planMigrationSql(``, "f", {})).toEqual([]);
  });

  it("refuses SQL Postgres can't parse", () => refused(`CREATE TABEL sb_x (a int);`, INVALID));
});

describe("smuggling: what the old splitter could be fooled into", () => {
  it("a $tag$ inside an identifier does not hide a statement", () =>
    refused(`CREATE TABLE sb_x$a$ (id int); DELETE FROM xcf_users; CREATE TABLE sb_y$a$ (id int);`, NAMING));
  it("an E'\\'' string does not hide a statement", () =>
    refused(`CREATE TABLE sb_e (a text DEFAULT E'\\''); DELETE FROM sb_e; CREATE TABLE sb_e2 (b text DEFAULT '');`, INVALID));
  it("comments and odd whitespace change nothing", () =>
    refused(`CREATE TABLE sb_a (a int) /* ; */ ;\n\t--;\nDELETE\n/**/FROM sb_a;`, INVALID));
  it("a quoted core name is still core", () => refused(`DROP TABLE "xcf_users";`, NAMING));
  it("a spaced schema qualifier is still core", () => refused(`DROP TABLE public . xcf_users;`, NAMING));
});

describe("no rows read or written, no code run while migrating", () => {
  it("refuses plain DML", () => refused(`INSERT INTO sb_rooms VALUES ('x');`, INVALID));
  it("refuses CREATE TABLE AS", () => refused(`CREATE TABLE sb_copy AS SELECT 1 AS a;`, INVALID));
  it("refuses a view", () => refused(`CREATE VIEW sb_v AS SELECT 1;`, INVALID));
  it("refuses DO blocks", () => refused(`DO $$ BEGIN PERFORM 1; END $$;`, INVALID));
  it("refuses a DEFAULT calling the plugin's own function", () =>
    refused(`CREATE TABLE sb_h (a int DEFAULT sb_g());`, INVALID));
  it("refuses a CHECK that runs SQL from a string", () =>
    refused(`ALTER TABLE sb_c ADD CONSTRAINT sb_ck CHECK (length(query_to_xml('DELETE FROM sb_c', true, true, '')::text) > 0);`, INVALID));
  it("refuses nextval on someone else's sequence", () =>
    refused(`CREATE TABLE sb_n (id int DEFAULT nextval('xcf_seq'));`, INVALID));
  it("allows nextval on its own sequence and ordinary built-ins", () =>
    accepted(`CREATE SEQUENCE sb_seq; CREATE TABLE sb_n (id int DEFAULT nextval('sb_seq'), at timestamptz DEFAULT now(), u uuid DEFAULT gen_random_uuid());`));
  it("refuses BEGIN ATOMIC function bodies", () =>
    refused(`CREATE FUNCTION sb_a() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;`, INVALID));
  it("refuses SECURITY DEFINER", () =>
    refused(`CREATE FUNCTION sb_d() RETURNS int AS 'SELECT 1' LANGUAGE sql SECURITY DEFINER;`, INVALID));
  it("refuses languages other than plpgsql and sql", () =>
    refused(`CREATE FUNCTION sb_c() RETURNS int AS 'x', 'y' LANGUAGE c;`, INVALID));
});

describe("only the plugin's own objects, in the public schema", () => {
  it("requires a tablePrefix once there is anything to run", () => refused(`CREATE TABLE rooms (id text);`, NAMING, {}));
  it("refuses a prefix that is reserved for core", () => refused(`CREATE TABLE xcf_x (id text);`, NAMING, { tablePrefix: "xcf_" }));
  it("refuses an unprefixed table", () => refused(`CREATE TABLE rooms (id text);`, NAMING));
  it("refuses an index whose name lacks the prefix", () => refused(`CREATE INDEX rooms_idx ON sb_rooms (id);`, NAMING));
  it("refuses an index on a core table", () => refused(`CREATE INDEX sb_evil ON xcf_users (email);`, NAMING));
  it("refuses another schema", () => refused(`CREATE TABLE other.sb_t (a int);`, NAMING));
  it("refuses CREATE SCHEMA", () => refused(`CREATE SCHEMA sb_s;`, INVALID));
  it("refuses ALTER TABLE on core", () => refused(`ALTER TABLE xcf_users ADD COLUMN evil text;`, NAMING));
  it("refuses ALTER INDEX on core", () => refused(`ALTER INDEX xcf_users_email_trgm RENAME TO sb_gone;`, NAMING));
  it("refuses renaming a core function", () => refused(`ALTER FUNCTION xcf_fn() RENAME TO sb_fn;`, NAMING));
  it("refuses renaming its own table to a name outside its prefix", () => refused(`ALTER TABLE sb_rooms RENAME TO rooms;`, NAMING));
  it("refuses changing a core enum", () => refused(`ALTER TYPE "Role" ADD VALUE 'z';`, NAMING));
  it("refuses dropping a core enum", () => refused(`DROP TYPE "Role" CASCADE;`, NAMING));
  it("refuses dropping another plugin's table", () => refused(`DROP TABLE pm_messages;`, NAMING));
  it("refuses dropping core bookkeeping, old and new names", async () => {
    for (const t of ["xentium_plugin_migrations", "nodevo_plugin_migrations", "ncf_users", "_prisma_migrations"]) {
      await refused(`DROP TABLE ${t};`, NAMING);
    }
  });
  it("refuses a trigger on a core table", () =>
    refused(`CREATE TRIGGER sb_t AFTER INSERT ON xcf_users FOR EACH ROW EXECUTE FUNCTION sb_f();`, NAMING));
  it("refuses INHERITS from a core table", () => refused(`CREATE TABLE sb_i () INHERITS (xcf_users);`, INVALID));
  it("refuses COMMENT on a core table", () => refused(`COMMENT ON TABLE xcf_users IS 'x';`, NAMING));
  it("refuses changing a table's owner", () => refused(`ALTER TABLE sb_o OWNER TO CURRENT_USER;`, INVALID));
  it("refuses a foreign key into core (core's Prisma migrations don't know plugin tables)", () =>
    refused(`CREATE TABLE sb_fk (user_id text REFERENCES xcf_users(id) ON DELETE CASCADE);`, NAMING));
  it("refuses a foreign key to a system catalog", () =>
    refused(`CREATE TABLE sb_fk (oid oid REFERENCES pg_class(oid));`, NAMING));
});

describe("extensions", () => {
  it("allows a listed extension with IF NOT EXISTS", () => accepted(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`));
  it("requires IF NOT EXISTS", () => refused(`CREATE EXTENSION pg_trgm;`, INVALID));
  it("refuses an extension that isn't listed", () => refused(`CREATE EXTENSION IF NOT EXISTS plpython3u;`, INVALID));
  it("never drops one (core's search indexes depend on pg_trgm)", () => refused(`DROP EXTENSION pg_trgm CASCADE;`, INVALID));
});

describe("what plugins actually do keeps working", () => {
  it("tables, indexes, columns and constraints", () =>
    accepted(`
      CREATE TABLE IF NOT EXISTS sb_rooms (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS sb_rooms_name ON sb_rooms (lower(name));
      CREATE TABLE sb_msgs (id text PRIMARY KEY, room_id text NOT NULL REFERENCES sb_rooms(id) ON DELETE CASCADE);
      ALTER TABLE sb_rooms ADD COLUMN topic text;
      ALTER TABLE sb_rooms ALTER COLUMN topic SET DEFAULT '';
      ALTER TABLE sb_rooms ADD CONSTRAINT sb_rooms_topic_len CHECK (char_length(topic) < 500);
      ALTER TABLE sb_rooms RENAME COLUMN topic TO subject;
      COMMENT ON COLUMN sb_rooms.subject IS 'shown above the room';`));
  it("a search-vector function and its trigger (the forum's pattern)", () =>
    accepted(`
      CREATE OR REPLACE FUNCTION sb_sv() RETURNS trigger AS $$
      BEGIN NEW.sv := setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A'); RETURN NEW; END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER sb_sv_t BEFORE INSERT OR UPDATE ON sb_rooms FOR EACH ROW EXECUTE FUNCTION sb_sv();`));
  it("a down migration", () =>
    accepted(`
      DROP TRIGGER IF EXISTS sb_sv_t ON sb_rooms;
      DROP FUNCTION IF EXISTS sb_sv();
      DROP INDEX IF EXISTS sb_rooms_name;
      DROP TABLE IF EXISTS sb_msgs, sb_rooms;
      DROP TYPE IF EXISTS sb_kind;
      DROP SEQUENCE IF EXISTS sb_seq;`));
  it("enums and their values", () =>
    accepted(`CREATE TYPE sb_kind AS ENUM ('a', 'b'); ALTER TYPE sb_kind ADD VALUE 'c';`));
});
