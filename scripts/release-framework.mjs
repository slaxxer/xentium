#!/usr/bin/env node
/**
 * Publish the framework packages to npm.
 *
 *   node scripts/release-framework.mjs            # publish the current version
 *   node scripts/release-framework.mjs --dry-run  # show what would happen
 *
 * The packages are published; `apps/api` still consumes them as `workspace:*`
 * and always will. Depending on the registry from inside the repo that produces
 * it would mean publishing a version before core could see its own change, and
 * would break Turborepo's build ordering. pnpm rewrites `workspace:*` to the
 * real version at pack time, so the published artifact is correct either way.
 *
 * This exists because publishing by hand went wrong twice in ways that only
 * showed up in a dry run: stale test files sitting in `dist`, and a first
 * publish silently taking the `latest` tag. Both are guarded below.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What gets published, in dependency order.
 *
 * NOT here: `@nodevo/config` (the shared tsconfig — a devDependency nobody
 * consuming needs) and `@nodevo/ui` (React components for the CMS, not
 * framework). `@nodevo/sdk` and `@nodevo/plugin-sdk` are absent too, which is
 * a real gap for third-party plugin authors — see the note at the foot of this
 * file.
 */
const PACKAGES = ["contracts", "errors", "server-kit", "auth", "plugin-engine"];

const dryRun = process.argv.includes("--dry-run");

// `stdio: "inherit"` streams to the terminal and returns null rather than a
// string, so the trim only applies when output was actually captured.
const run = (cmd, args, opts = {}) => {
  const out = execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  return typeof out === "string" ? out.trim() : "";
};

const fail = (msg, hint) => {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

// ── 1. Never publish a working tree that is not committed ───────────────────
// A published version is permanent and can never be reused, so "what is in this
// tarball" has to be answerable from a commit rather than from someone's memory.
const dirty = run("git", ["status", "--porcelain"]);
if (dirty && !dryRun) {
  fail(
    "the working tree has uncommitted changes",
    "Commit or stash first — a published version can never be reused, so it must be traceable to a commit.",
  );
}

// ── 2. One version, read from the repo ──────────────────────────────────────
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// Prerelease identifier becomes the dist-tag, so `npm install @nodevo/errors`
// keeps resolving the last STABLE release rather than an alpha.
const prerelease = /-([0-9A-Za-z-]+)/.exec(version)?.[1];
const tag = prerelease ?? "latest";

console.log(`Publishing @nodevo/* ${version} with tag "${tag}"${dryRun ? " (dry run)" : ""}\n`);

// ── 3. Refuse a version that is already on the registry ─────────────────────
// npm rejects it anyway, but partway through a multi-package publish — leaving
// some packages up and some not, with the version burned either way.
const alreadyPublished = [];
for (const name of PACKAGES) {
  try {
    const versions = JSON.parse(
      run("npm", ["view", `@nodevo/${name}`, "versions", "--json"], { stdio: ["ignore", "pipe", "ignore"] }),
    );
    if ([].concat(versions).includes(version)) alreadyPublished.push(`@nodevo/${name}`);
  } catch {
    // Not published at all yet — which is fine, and expected the first time.
  }
}

if (alreadyPublished.length > 0) {
  fail(
    `${version} is already on the registry for: ${alreadyPublished.join(", ")}`,
    "Bump first: node scripts/set-version.mjs <next version>",
  );
}

// ── 4. Build, then publish ──────────────────────────────────────────────────
// `prepublishOnly` builds each package too; doing it up front means a compile
// error stops the run BEFORE anything is published rather than midway.
console.log("Building…");
const filters = PACKAGES.flatMap((n) => ["--filter", `@nodevo/${n}`]);
run("pnpm", [...filters, "build"], { stdio: "inherit" });

console.log("\nPublishing…");
run(
  "pnpm",
  [
    "-r",
    ...filters,
    "publish",
    "--tag",
    tag,
    // The repo tags releases itself; pnpm's own git checks would refuse a
    // perfectly good publish for want of a tag it expects to create.
    "--no-git-checks",
    ...(dryRun ? ["--dry-run"] : []),
  ],
  { stdio: "inherit" },
);

if (dryRun) {
  console.log("\nDry run — nothing was published.");
} else {
  console.log(`\nPublished @nodevo/* ${version} (tag: ${tag}).`);
  console.log("Consumers outside this repo pick it up with: pnpm update @nodevo/*");
}

/*
 * ── Not published, and worth revisiting ────────────────────────────────────
 *
 * `@nodevo/plugin-sdk` is the authoring contract for THIRD-PARTY plugins, and
 * it is not on the registry. An outside author therefore cannot install the one
 * package they need in order to build against Nodevo at all — they would have to
 * vendor it out of the repo.
 *
 * It is held back for one reason: ADR-0006 splits it into a generic half and a
 * CMS-shaped half, and that split is a breaking change for the four official
 * plugins. Publishing before the split would put a version on the registry that
 * is known to be wrong. Publish it immediately after.
 */
