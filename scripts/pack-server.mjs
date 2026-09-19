#!/usr/bin/env node
/**
 * Build the `@xentium/server` npm package: the whole app, ready to install without a
 * clone (ADR-0010).
 *
 *   node scripts/pack-server.mjs            # uses the existing builds
 *   node scripts/pack-server.mjs --build    # runs the api + web builds first
 *
 * Output: dist/release/server/ (the package) and dist/release/xentium-server-<v>.tgz.
 * Nothing is published; publishing happens from CI with provenance.
 *
 * The package MIRRORS the repo layout (apps/api/dist, apps/web/dist, prisma/,
 * packages/sdk/src/license-public-key.pem) with the package root in the role of the
 * repo root. That way every default the API already resolves from REPO_ROOT keeps
 * working unchanged, and the only thing an install has to tell it is where its
 * `.env` lives (XENTIUM_ENV_FILE) plus where uploads and data go.
 *
 * Dependencies are the EXACT versions pnpm installed here, and the package ships an
 * npm-shrinkwrap.json: npm honours a shrinkwrap inside a published package (it
 * ignores a lockfile), so every server installs the tree we tested.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/release");
const STAGE = join(OUT, "server");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();

const fail = (msg, hint) => {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

// ── 1. Builds ────────────────────────────────────────────────────────────────
if (process.argv.includes("--build")) {
  console.log("building api + web …");
  execFileSync("pnpm", ["turbo", "run", "build", "--filter=@xentium/api", "--filter=@xentium/web"], {
    cwd: ROOT, stdio: "inherit",
  });
}
for (const f of ["apps/api/dist/server.js", "apps/api/dist/worker.js", "apps/web/dist/index.html"]) {
  if (!existsSync(join(ROOT, f))) fail(`missing ${f}`, "run with --build, or `pnpm turbo run build` first");
}

// ── 2. Exact dependency versions ─────────────────────────────────────────────
const apiPkg = JSON.parse(readFileSync(join(ROOT, "apps/api/package.json"), "utf8"));
const version = apiPkg.version;

const installed = JSON.parse(run("pnpm", ["--filter", "@xentium/api", "ls", "--prod", "--depth", "0", "--json"]))[0].dependencies;
const dependencies = {};
for (const [name, info] of Object.entries(installed)) {
  // Our own workspace packages are bundled into dist by tsup; they're not dependencies.
  if (info.version.startsWith("link:")) continue;
  dependencies[name] = info.version;
}
// The Prisma CLI: `migrate deploy` runs on the server (installer + `xentium update`).
const rootDev = JSON.parse(run("pnpm", ["ls", "prisma", "--depth", "0", "--json"]))[0].devDependencies ?? {};
if (!rootDev.prisma) fail("could not resolve the prisma CLI version");
dependencies.prisma = rootDev.prisma.version;
const sorted = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));

// ── 3. Stage ─────────────────────────────────────────────────────────────────
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const copy = (from, to = from) => cpSync(join(ROOT, from), join(STAGE, to), { recursive: true });
copy("apps/api/dist");
copy("apps/web/dist");
copy("prisma/schema.prisma");
copy("prisma/migrations");
copy("prisma.config.ts");
copy("packages/sdk/src/license-public-key.pem");
copy("LICENSE");

// version.ts reads the version from the api package.json next to dist.
writeFileSync(join(STAGE, "apps/api/package.json"),
  JSON.stringify({ name: "@xentium/api", version, private: true, type: "module" }, null, 2) + "\n");

writeFileSync(join(STAGE, "package.json"), JSON.stringify({
  name: "@xentium/server",
  version,
  description: "Xentium, the open-source community platform, ready to run. Install it with `npm create xentium`.",
  license: "MIT",
  type: "module",
  homepage: "https://doc.xentium.org",
  repository: { type: "git", url: "git+https://github.com/slaxxer/xentium.git" },
  engines: { node: ">=22.12" },
  // Where the two processes live, for the `xentium` CLI and anyone writing their own units.
  xentium: {
    workingDirectory: "apps/api",
    server: "dist/server.js",
    worker: "dist/worker.js",
  },
  dependencies: sorted,
  publishConfig: { access: "public" },
}, null, 2) + "\n");

writeFileSync(join(STAGE, "README.md"), `# @xentium/server

Xentium, the open-source community platform, as a ready-to-run package.

You normally don't install this directly. Run:

\`\`\`bash
npm create xentium@latest my-community
\`\`\`

That checks your system, sets up the database, installs this package and starts the
install wizard. Docs: https://doc.xentium.org
`);

// ── 4. Pin the tree ──────────────────────────────────────────────────────────
console.log("resolving the dependency tree …");
run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: STAGE });
run("npm", ["shrinkwrap"], { cwd: STAGE });
if (!existsSync(join(STAGE, "npm-shrinkwrap.json"))) fail("npm shrinkwrap produced nothing");

// ── 5. Pack ──────────────────────────────────────────────────────────────────
const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", OUT], { cwd: STAGE }))[0];
const tgz = join(OUT, packed.filename);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`✓ ${packed.name}@${packed.version}`);
console.log(`  ${tgz}`);
console.log(`  ${packed.entryCount} files · ${mb(statSync(tgz).size)} MB packed · ${mb(packed.unpackedSize)} MB unpacked`);
console.log(`  ${Object.keys(sorted).length} direct dependencies, pinned by npm-shrinkwrap.json`);
