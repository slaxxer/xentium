#!/usr/bin/env node
/**
 * Publish the framework packages to npm.
 *
 *   node scripts/release-framework.mjs --otp=123456   # publish the current version
 *   node scripts/release-framework.mjs --dry-run      # show what would happen
 *
 * A full release publishes these AND the app AND the installers, in one act:
 * `node scripts/publish-release.mjs`, which is what CI runs. Use this script on
 * its own only when the framework is the only thing that moved.
 *
 * npm requires a 2FA code to publish. Pass it with --otp and run immediately —
 * codes expire in about 30 seconds.
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
 * NOT here: `@xentium/config` (the shared tsconfig — a devDependency nobody
 * consuming needs), `@xentium/ui` (React components for the CMS, not framework),
 * and `@xentium/sdk` (core runtime helpers plus the licence public key, which is
 * a CMS concern).
 */
const PACKAGES = ["contracts", "errors", "server-kit", "auth", "plugin-engine", "plugin-kit", "plugin-sdk"];

const dryRun = process.argv.includes("--dry-run");

/**
 * Publish with npm provenance. Only works from CI — npm builds the attestation
 * from the GitHub Actions OIDC token — so the release workflow passes it and a
 * local publish does not.
 */
const provenance = process.argv.includes("--provenance");

/**
 * Skip packages already published at this version instead of refusing the run.
 *
 * The refusal below is right for a human: it means "you forgot to bump". It is
 * wrong for a re-run of a release that failed halfway, where some packages are
 * up and some are not, and the version can never be reused.
 */
const skipPublished = process.argv.includes("--skip-published");

/**
 * A one-time 2FA code. npm requires one to publish unless the credential is a
 * granular token with 2FA bypass — and it should not be, for a token that can
 * publish. Codes expire in about 30 seconds, so fetch one immediately before
 * running this.
 */
const otpArg = process.argv.find((a) => a.startsWith("--otp="));
const otp = otpArg?.slice("--otp=".length);

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

// Prerelease identifier becomes the dist-tag, so `npm install @xentium/errors`
// keeps resolving the last STABLE release rather than an alpha.
const prerelease = /-([0-9A-Za-z-]+)/.exec(version)?.[1];
const tag = prerelease ?? "latest";

console.log(`Publishing @xentium/* ${version} with tag "${tag}"${dryRun ? " (dry run)" : ""}\n`);

// ── 3. Refuse a version that is already on the registry ─────────────────────
// npm rejects it anyway, but partway through a multi-package publish — leaving
// some packages up and some not, with the version burned either way.
const alreadyPublished = [];
for (const name of PACKAGES) {
  try {
    const versions = JSON.parse(
      run("npm", ["view", `@xentium/${name}`, "versions", "--json"], { stdio: ["ignore", "pipe", "ignore"] }),
    );
    if ([].concat(versions).includes(version)) alreadyPublished.push(`@xentium/${name}`);
  } catch {
    // Not published at all yet — which is fine, and expected the first time.
  }
}

if (alreadyPublished.length > 0 && !skipPublished) {
  fail(
    `${version} is already on the registry for: ${alreadyPublished.join(", ")}`,
    "Bump first: node scripts/set-version.mjs <next version>",
  );
}

const remaining = PACKAGES.filter((n) => !alreadyPublished.includes(`@xentium/${n}`));
if (remaining.length === 0) {
  console.log(`Every framework package is already published at ${version} — nothing to do.`);
  process.exit(0);
}
if (alreadyPublished.length > 0) {
  console.log(`Skipping, already published at ${version}: ${alreadyPublished.join(", ")}\n`);
}

// ── 4. Build, then publish ──────────────────────────────────────────────────
// `prepublishOnly` builds each package too; doing it up front means a compile
// error stops the run BEFORE anything is published rather than midway.
console.log("Building…");
const filters = remaining.flatMap((n) => ["--filter", `@xentium/${n}`]);
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
    ...(provenance ? ["--provenance"] : []),
    ...(otp ? ["--otp", otp] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ],
  { stdio: "inherit" },
);

if (dryRun) {
  console.log("\nDry run — nothing was published.");
} else {
  console.log(`\nPublished @xentium/* ${version} (tag: ${tag}).`);
  console.log("Consumers outside this repo pick it up with: pnpm update @xentium/*");
}
