import { afterEach, describe, expect, it } from "vitest";
import { maskUrl, maskedCommand } from "./cli.js";
import type { MigrateAdapter } from "./types.js";

// The command is stored in the target database and shown in the ACP, so a
// connection string's credentials must never survive into it.
const adapter = { name: "xenforo", version: "1.0.0" } as MigrateAdapter;
const pkgBefore = process.env.npm_package_name;
afterEach(() => { process.env.npm_package_name = pkgBefore; });

describe("maskUrl", () => {
  it("keeps the scheme and database, drops user, password, host and query", () => {
    expect(maskUrl("mysql://root:s3cret@db.internal:3306/xenforo?ssl=true")).toBe("mysql://…/xenforo");
  });

  it("drops everything it cannot parse", () => {
    expect(maskUrl("root:s3cret@db/xenforo")).toBe("…");
  });
});

describe("maskedCommand", () => {
  it("names the package pnpm ran and never carries a credential", () => {
    process.env.npm_package_name = "@xentium/migrate-xenforo";
    const cmd = maskedCommand(adapter, {
      "source-db": "mysql://root:s3cret@db.internal/xenforo",
      db: "postgresql://xentium:hunter2@localhost/xentium",
      prefix: "xf_",
      yes: true,
    });
    expect(cmd).toBe('pnpm --filter @xentium/migrate-xenforo migrate -- --source-db "mysql://…/xenforo" --prefix xf_ --db "postgresql://…"');
    expect(cmd).not.toMatch(/s3cret|hunter2|root|db\.internal|--yes/);
  });

  it("quotes a file path with spaces", () => {
    process.env.npm_package_name = "@xentium/migrate-wp";
    expect(maskedCommand({ ...adapter, name: "wordpress" }, { file: "my export.xml" }))
      .toBe('pnpm --filter @xentium/migrate-wp migrate -- --file "my export.xml" --db "postgresql://…"');
  });
});
