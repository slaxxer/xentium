import readline from "node:readline/promises";
import pg from "pg";
import { missingPlugins } from "./loader.js";
import { writeRedirects } from "./redirects.js";
import { runMigration } from "./runner.js";
import type { AdapterSource, MigrateAdapter, MigrationReporter } from "./types.js";

/**
 * Shared CLI driver — each adapter package's bin is a two-liner calling this.
 *
 *   xentium-migrate-wp --file export.xml --db postgresql://… [--dry-run] [--yes]
 *
 * Flow mirrors §34: inspect → show counts/warnings/preconditions → confirm →
 * run → summary. `--dry-run` extracts and reports without writing anything.
 */
export async function runAdapterCli(adapter: MigrateAdapter, argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const str = (v: string | true | undefined) => (typeof v === "string" ? v : undefined);
  const source: AdapterSource = {
    file: str(args.file),
    db: str(args["source-db"]),
    tablePrefix: str(args.prefix),
    filesDir: str(args.files),
  };
  const targetDb = str(args.db) ?? process.env.DATABASE_URL;

  if ((!source.file && !source.db) || !targetDb) {
    console.log(`Usage: xentium-migrate-${adapter.name} [--file <export>] [--source-db <url>] [--prefix <table prefix>] [--files <old site folder>] [--uploads <Xentium upload folder>] --db <xentium postgres url> [--dry-run] [--yes] [--redirects <folder> [--redirects-only]]`);
    process.exitCode = 1;
    return;
  }
  const redirectsDir = str(args.redirects);
  if (args.redirects === true || (args["redirects-only"] && !redirectsDir)) {
    console.log(`--redirects needs a folder to write the redirect files to.`);
    process.exitCode = 1;
    return;
  }

  // Redirects only: the import already ran, write (or rewrite) the files from it.
  if (args["redirects-only"]) {
    await redirectsStep(adapter, source, targetDb, redirectsDir!);
    return;
  }

  const reporter = consoleReporter();

  console.log(`\nInspecting source…`);
  const inspection = await adapter.inspect(source);
  console.log(`\n  Source: ${inspection.platform}`);
  for (const [entity, count] of Object.entries(inspection.counts)) {
    console.log(`    ${entity.padEnd(12)} ${count.toLocaleString()}`);
  }
  if (inspection.warnings.length) {
    console.log(`\n  Warnings:`);
    for (const w of inspection.warnings) console.log(`    ! ${w}`);
  }
  // Target-side preconditions (§34): required plugins must be enabled.
  const targetMissing: string[] = [];
  if (adapter.requiredPlugins?.length) {
    const pool = new pg.Pool({ connectionString: targetDb, max: 1 });
    try {
      const missing = await missingPlugins(pool, adapter.requiredPlugins);
      for (const id of adapter.requiredPlugins) {
        if (missing.includes(id)) targetMissing.push(`Plugin "${id}" installed and enabled on the target (ACP → Extensions)`);
        else console.log(`    + Plugin "${id}" installed and enabled`);
      }
    } finally {
      await pool.end();
    }
  }

  if (inspection.preconditions.missing.length || targetMissing.length) {
    console.log(`\n  Missing preconditions:`);
    for (const p of [...inspection.preconditions.missing, ...targetMissing]) console.log(`    x ${p}`);
    console.log(`\nAborting — nothing was touched.`);
    process.exitCode = 1;
    return;
  }

  if (args["dry-run"]) {
    console.log(`\nDry run — extracting without writing…`);
  } else if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nProceed with the migration? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Aborted — nothing was touched.");
      return;
    }
  }

  const summary = await runMigration(
    adapter, source, { targetDb, dryRun: !!args["dry-run"], command: maskedCommand(adapter, args), uploadsDir: str(args.uploads) }, reporter,
  );

  console.log(`\nDone in ${(summary.durationMs / 1000).toFixed(1)}s`);
  for (const [entity, count] of Object.entries(summary.counts)) {
    console.log(`  ${entity.padEnd(12)} ${count.toLocaleString()}`);
  }
  if (summary.errors.length) {
    console.log(`\n  ${summary.errors.length} skipped/failed (also recorded in ACP → System → Migration History):`);
    for (const e of summary.errors.slice(0, 20)) {
      console.log(`    ${e.entity} ${e.sourceId}: ${e.reason}`);
    }
    if (summary.errors.length > 20) console.log(`    … and ${summary.errors.length - 20} more`);
  }
  if (redirectsDir) {
    if (args["dry-run"]) console.log(`\nRedirects: not written on a dry run (nothing was imported to point at).`);
    else {
      try {
        await redirectsStep(adapter, source, targetDb, redirectsDir);
      } catch (err) {
        console.log(`\nRedirects failed: ${(err as Error).message}`);
        console.log(`The import itself finished. Run the same command with --redirects-only to try again.`);
        process.exitCode = 1;
      }
    }
  }
}

async function redirectsStep(adapter: MigrateAdapter, source: AdapterSource, targetDb: string, dir: string): Promise<void> {
  if (!adapter.redirects) {
    console.log(`\nRedirects: the ${adapter.name} importer doesn't know its old addresses, so none were written.`);
    return;
  }
  const spec = await adapter.redirects(source);
  const pool = new pg.Pool({ connectionString: targetDb, max: 1 });
  try {
    const out = await writeRedirects(pool, adapter.name, spec, dir);
    console.log(`\nRedirects: ${out.count.toLocaleString()} old addresses mapped.`);
    console.log(`  nginx: ${out.nginx}  (how to include it is at the top of the file)`);
    console.log(`  CSV:   ${out.csv}`);
  } finally {
    await pool.end();
  }
}

/**
 * The command that started this run, safe to store and show: every connection
 * string is reduced to its scheme and database name, so a password never lands
 * in the target database or the ACP. The admin fills the rest back in.
 */
export function maskedCommand(adapter: MigrateAdapter, args: Record<string, string | true>): string {
  const pkg = process.env.npm_package_name ?? `@xentium/migrate-${adapter.name}`;
  const parts = [`pnpm --filter ${pkg} migrate --`];
  if (typeof args.file === "string") parts.push(`--file ${quote(args.file)}`);
  if (typeof args["source-db"] === "string") parts.push(`--source-db ${quote(maskUrl(args["source-db"]))}`);
  if (typeof args.prefix === "string") parts.push(`--prefix ${quote(args.prefix)}`);
  if (typeof args.files === "string") parts.push(`--files ${quote(args.files)}`);
  if (typeof args.uploads === "string") parts.push(`--uploads ${quote(args.uploads)}`);
  if (typeof args.redirects === "string") parts.push(`--redirects ${quote(args.redirects)}`);
  parts.push(`--db "postgresql://…"`);
  return parts.join(" ");
}

/** `mysql://user:pw@host:3306/forum?x=1` → `mysql://…/forum`. */
export function maskUrl(raw: string): string {
  // Only a real `scheme://` URL: `user:pw@host/db` also parses, as scheme "user:"
  // with the password in its path.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "…";
  try {
    const url = new URL(raw);
    const db = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${url.protocol}//…${/^[\w.-]+$/.test(db) ? `/${db}` : ""}`;
  } catch {
    return "…";
  }
}

function quote(value: string): string {
  return /^[\w./:@%+=,-]+$/.test(value) && !value.includes("…") ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function consoleReporter(): MigrationReporter {
  let lastLine = "";
  return {
    info:  (m) => { process.stdout.write(`\n${m}\n`); lastLine = ""; },
    warn:  (m) => { process.stdout.write(`\n! ${m}\n`); lastLine = ""; },
    progress: (entity, done, total) => {
      const line = `  ${entity}: ${done}/${total}`;
      if (line !== lastLine) { process.stdout.write(`\r${line}`); lastLine = line; }
      if (done === total) process.stdout.write("\n");
    },
  };
}
