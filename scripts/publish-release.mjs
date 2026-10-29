#!/usr/bin/env node
/**
 * Publish a Xentium release: the framework packages, the app (`@xentium/server`),
 * and the two installers (`xentium`, `create-xentium`).
 *
 *   node scripts/publish-release.mjs --dry-run         # show what would happen
 *   node scripts/publish-release.mjs --provenance      # what CI runs
 *   node scripts/publish-release.mjs --only=server
 *
 * It publishes under the prerelease id (`alpha`) and leaves `latest` alone: moving
 * that is a separate, manual step that CI cannot do.
 *
 * ONE script for all four, because a release is one act: every workspace package
 * carries the same version (scripts/set-version.mjs keeps them in lockstep), and
 * publishing three of the four leaves an instance able to install a server whose
 * CLI cannot update it.
 *
 * Already-published versions are SKIPPED, not fatal. A publish that fails
 * halfway — npm rate-limits, a dropped connection, an expired OTP — has to be
 * safe to re-run, and a burned version number cannot be reused.
 *
 * Provenance is opt-in via `--provenance` because it only works from CI: npm
 * derives the attestation from the GitHub Actions OIDC token, and the source
 * repository has to be public. The workflow decides and says why.
 *
 * What this does NOT do is tell anyone. An installed site learns about a release
 * from its update source, not from the registry, and that record carries an
 * urgency a person decides. This script only ships the bytes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/release");

/** The framework packages, published by their own script (see PACKAGES there). */
const FRAMEWORK = "framework";
/** The app itself: built by pack-server.mjs, published from its staging directory. */
const SERVER = "server";
/** The installers. `xentium` first — `create-xentium` installs it. */
const INSTALLERS = [
  { part: "cli", name: "xentium", dir: "packages/cli" },
  { part: "create", name: "create-xentium", dir: "packages/create-xentium" },
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const dryRun = flag("dry-run");
const provenance = flag("provenance");
const only = value("only");
const expectVersion = value("expect-version");
const tagOverride = value("tag");

const run = (cmd, args, opts = {}) => {
  const out = execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  return typeof out === "string" ? out.trim() : "";
};

const fail = (msg, hint) => {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

const heading = (text) => console.log(`\n── ${text} ${"─".repeat(Math.max(0, 68 - text.length))}`);

const wanted = (part) => !only || only === "all" || only === part;

// ── 1. One version, read from the repo ───────────────────────────────────────
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// A tag-triggered run passes the tag it was cut from. They disagree when someone
// tags before bumping, and the result is a published version nobody can trace
// back to a commit.
if (expectVersion && expectVersion !== version) {
  fail(
    `the tag says ${expectVersion} but the repo is on ${version}`,
    "Bump with `node scripts/set-version.mjs <version>`, commit, then tag that commit.",
  );
}

// Prerelease identifier becomes the dist-tag, so `npm install @xentium/server`
// keeps resolving the last STABLE release rather than an alpha. Same rule as
// release-framework.mjs — releases move together or not at all.
const prerelease = /-([0-9A-Za-z-]+)/.exec(version)?.[1];
const tag = tagOverride ?? prerelease ?? "latest";

// ── 2. Refuse a working tree that is not committed ───────────────────────────
// A published version is permanent, so "what is in this tarball" has to be
// answerable from a commit rather than from someone's memory.
if (!dryRun && run("git", ["status", "--porcelain"])) {
  fail(
    "the working tree has uncommitted changes",
    "Commit or stash first — a published version can never be reused.",
  );
}

// ── 3. Credentials, before anything is built ─────────────────────────────────
// In the release workflow there is no login to check: npm Trusted Publishing signs
// each `npm publish` in with the workflow's OIDC identity (`id-token: write`), so
// `npm whoami` fails there by design. npm itself refuses the upload if this
// workflow is not the package's trusted publisher.
const trustedPublishing = !!process.env.GITHUB_ACTIONS && !!process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
if (!dryRun && trustedPublishing) {
  console.log("npm: trusted publishing (GitHub Actions OIDC identity)");
} else if (!dryRun) {
  try {
    const who = run("npm", ["whoami"], { stdio: ["ignore", "pipe", "ignore"] });
    console.log(`npm: authenticated as ${who}`);
  } catch {
    fail(
      "npm is not authenticated",
      "Locally: `npm login`. In CI: set the NPM_TOKEN secret (a granular automation token).",
    );
  }
}

console.log(`\nXentium ${version} → npm tag "${tag}"${dryRun ? "  (dry run)" : ""}`);
console.log(`provenance: ${provenance ? "on" : "off"}${only ? `\nonly: ${only}` : ""}`);

/** Is this exact version already on the registry? */
const isPublished = (name) => {
  try {
    const versions = JSON.parse(
      run("npm", ["view", name, "versions", "--json"], { stdio: ["ignore", "pipe", "ignore"] }),
    );
    return [].concat(versions).includes(version);
  } catch {
    return false; // not published at all yet — expected the first time
  }
};

const published = [];
const skipped = [];
/** The framework script reports its own skips; don't claim its work here. */
let ranFramework = false;

// ── 4. Framework packages ────────────────────────────────────────────────────
if (wanted(FRAMEWORK)) {
  heading("framework packages");
  run("node", [join(ROOT, "scripts/release-framework.mjs"), "--skip-published",
    ...(provenance ? ["--provenance"] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ], { stdio: "inherit" });
  ranFramework = true;
}

// ── 5. The app ───────────────────────────────────────────────────────────────
if (wanted(SERVER)) {
  heading("@xentium/server");
  if (isPublished("@xentium/server")) {
    console.log(`already on the registry at ${version} — skipping`);
    skipped.push("@xentium/server");
  } else {
    // --build so the tarball is made from a fresh api + web build rather than
    // whatever happened to be in dist. pack-server writes the tgz too, which is
    // what an offline install and `xentium update --package` use.
    run("node", [join(ROOT, "scripts/pack-server.mjs"), "--build"], { stdio: "inherit" });
    const stage = join(OUT, "server");
    if (!existsSync(join(stage, "npm-shrinkwrap.json"))) {
      fail("the staged package has no npm-shrinkwrap.json", "pack-server.mjs should have written one");
    }
    run("npm", ["publish", "--tag", tag, "--access", "public",
      ...(provenance ? ["--provenance"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ], { cwd: stage, stdio: "inherit" });
    published.push("@xentium/server");
  }
}

// ── 6. The installers ────────────────────────────────────────────────────────
for (const { part, name, dir } of INSTALLERS) {
  if (!wanted(part)) continue;
  heading(name);
  const cwd = join(ROOT, dir);

  // Build and pack whatever happens next: the tarball is a release asset, and a
  // box without the published names installs from it (`--package`, `--cli`).
  run("pnpm", ["--filter", name, "build"], { stdio: "inherit" });
  // pnpm, not npm: it rewrites `workspace:*` to the real version and carries the
  // repo LICENSE in, so the tarball is byte-for-byte what a publish would send.
  run("pnpm", ["pack", "--pack-destination", OUT], { cwd, stdio: ["ignore", "pipe", "inherit"] });

  if (isPublished(name)) {
    console.log(`already on the registry at ${version} — skipping`);
    skipped.push(name);
    continue;
  }
  // The tarball pnpm just packed, published by npm: pnpm rewrote `workspace:*`,
  // and npm is what speaks Trusted Publishing (see release-framework.mjs).
  const tgz = join(OUT, `${name}-${version}.tgz`);
  if (!existsSync(tgz)) fail(`expected ${tgz} from pnpm pack`);
  run("npm", ["publish", tgz, "--tag", tag, "--access", "public",
    ...(provenance ? ["--provenance"] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ], { stdio: "inherit" });
  published.push(name);
}

// ── 7. What is left to do, which is the part that reaches admins ─────────────
heading("done");
if (ranFramework) console.log("framework:  see above");
if (published.length) console.log(`published: ${published.join(", ")}`);
if (skipped.length) console.log(`skipped (already published): ${skipped.join(", ")}`);
console.log(`tarballs:  ${OUT}`);

if (dryRun) {
  console.log("\nDry run — nothing was published.");
} else {
  console.log(`
${version} is on npm under "${tag}".${tag === "latest" ? "" : ` \`latest\` has NOT moved: move
it on your own npm login once every part is up.`}

Nothing has been ANNOUNCED: an installed site learns about
a release from its update source, not from the registry, and that record carries
the urgency deciding whether an admin is interrupted. Publishing and announcing
are separate acts on purpose, and the second one is a person's call.`);
}
