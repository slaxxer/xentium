// Build and package a Xentium plugin into a distributable .nvplugin (ZIP) file.
//
// Usage:
//   node scripts/package-plugin.mjs [pluginDir] [outDir] [--no-build]
//
//   pluginDir   plugin source dir (default: plugins/official/xentium-forum)
//   outDir      output dir        (default: dist/marketplace)
//   --no-build  skip running the plugin's build (use existing dist output)
//
// Produces an archive the host plugin-engine extracts and loads at runtime:
//   manifest.json (root), migrations/<name>.up.sql + <name>.down.sql,
//   compiled server bundle (server/dist), compiled web bundle (web/dist),
//   and package.json. Manifest entrypoints are package-relative compiled paths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// adm-zip lives in apps/api's node_modules — resolve it from there so this
// script works no matter the current working directory.
const require = createRequire(path.join(REPO_ROOT, "apps/api/package.json"));
const AdmZip = require("adm-zip");

function resolveArg(arg, fallback) {
  if (!arg || arg.startsWith("--")) arg = fallback;
  return path.isAbsolute(arg) ? arg : path.join(REPO_ROOT, arg);
}

/** Recursively collect files under `dir`, returned relative to `baseDir`. */
function collectFiles(dir, baseDir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, baseDir, out);
    else if (entry.isFile()) out.push(path.relative(baseDir, full));
  }
  return out;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const noBuild = process.argv.includes("--no-build");
  const pluginDir = resolveArg(args[0], "plugins/official/xentium-forum");
  const outDir = resolveArg(args[1], "dist/marketplace");

  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`✖ No manifest.json in ${pluginDir}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // Build the plugin (server + web bundles) unless skipped.
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
  if (!noBuild && pkgJson.scripts?.build) {
    console.log(`▶ Building ${pkgJson.name} …`);
    execSync("pnpm run build", { cwd: pluginDir, stdio: "inherit" });
  }

  // Validate every declared migration has an up + down file.
  for (const name of manifest.migrations ?? []) {
    for (const dir of ["up", "down"]) {
      if (!fs.existsSync(path.join(pluginDir, "migrations", `${name}.${dir}.sql`))) {
        console.error(`✖ Missing migration file: migrations/${name}.${dir}.sql`);
        process.exit(1);
      }
    }
  }

  // Validate compiled entrypoints exist.
  for (const [key, rel] of Object.entries(manifest.entrypoints ?? {})) {
    if (rel && !fs.existsSync(path.join(pluginDir, rel))) {
      console.error(`✖ Entrypoint "${key}" not built: ${rel} (run the plugin build first)`);
      process.exit(1);
    }
  }

  const zip = new AdmZip();

  // Only runtime artifacts: manifest, package.json, migrations, compiled bundles.
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  if (fs.existsSync(path.join(pluginDir, "package.json"))) {
    zip.addLocalFile(path.join(pluginDir, "package.json"), "");
  }
  for (const rel of collectFiles(path.join(pluginDir, "migrations"), pluginDir)) {
    zip.addLocalFile(path.join(pluginDir, rel), path.posix.dirname(rel.split(path.sep).join("/")));
  }
  for (const sub of ["server/dist", "web/dist"]) {
    for (const rel of collectFiles(path.join(pluginDir, sub), pluginDir)) {
      zip.addLocalFile(path.join(pluginDir, rel), path.posix.dirname(rel.split(path.sep).join("/")));
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${manifest.id}-${manifest.version}.nvplugin`);
  zip.writeZip(outFile);

  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n✔ Packaged ${manifest.name} v${manifest.version}`);
  console.log(`  → ${path.relative(REPO_ROOT, outFile)}  (${sizeKb} KB, ${zip.getEntries().length} entries)`);
  console.log(`  migrations: ${(manifest.migrations ?? []).length}`);
  console.log(`  server:     ${manifest.entrypoints?.server ?? "—"}`);
  console.log(`  web:        ${manifest.entrypoints?.web ?? "—"}`);
  console.log(`  license:    ${manifest.licenseRequired ? "required" : "free"}\n`);
}

main();
