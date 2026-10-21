/**
 * Download a release's own packages before npm installs it, so the ACP can show
 * each one arriving.
 *
 * `npm install` reports nothing per package. So the updater first fetches what
 * the update changes (`@xentium/server`, which carries our code, and each direct
 * dependency whose version moves), streaming each tarball and counting bytes,
 * checks every one against the integrity hash the registry publishes, and hands
 * it to npm's cache. The install that follows finds them there; the rest of the
 * tree it fetches itself. Nothing here is required: if a download fails, npm downloads that
 * package in the install, which verifies it the same way.
 */
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./checks.js";
import { exec, SERVER_PACKAGE } from "./release.js";
import type { Reporter, RunPackage } from "./progress.js";
import type { Site } from "./site.js";

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  dist?: { tarball?: string; integrity?: string; unpackedSize?: number };
}

async function registry(): Promise<string> {
  const configured = (await run("npm", ["config", "get", "registry"], 10_000))?.trim();
  const url = configured && /^https?:\/\//.test(configured) ? configured : "https://registry.npmjs.org/";
  return url.endsWith("/") ? url : `${url}/`;
}

async function manifest(base: string, name: string, version: string): Promise<Manifest> {
  const res = await fetch(`${base}${name.replace("/", "%2f")}/${encodeURIComponent(version)}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${name}@${version}: the registry answered ${res.status}`);
  return (await res.json()) as Manifest;
}

/** The running release's server manifest: its version and the dependencies it pinned. */
async function runningServer(site: Site): Promise<{ version: string | null; dependencies: Record<string, string> }> {
  try {
    const pkg = JSON.parse(await fs.readFile(
      path.join(site.currentLink, "node_modules", ...SERVER_PACKAGE.split("/"), "package.json"), "utf8",
    )) as { version?: string; dependencies?: Record<string, string> };
    return { version: pkg.version ?? null, dependencies: pkg.dependencies ?? {} };
  } catch {
    return { version: null, dependencies: {} };
  }
}

/**
 * What an update changes: the server itself (our code is bundled inside it) and
 * every direct dependency whose pinned version differs from the running release,
 * so the list says exactly which libraries move and from what to what.
 */
export async function releasePackages(site: Site, version: string): Promise<RunPackage[]> {
  const base = await registry();
  const [server, running] = await Promise.all([manifest(base, SERVER_PACKAGE, version), runningServer(site)]);
  const changed = Object.entries(server.dependencies ?? {})
    .filter(([name, spec]) => /^\d+\.\d+\.\d+/.test(spec) && running.dependencies[name] !== spec)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, spec]) => ({ name, from: running.dependencies[name] ?? null, to: spec }));
  return [{ name: SERVER_PACKAGE, from: running.version, to: version }, ...changed]
    .map((p) => ({ ...p, size: null, received: 0, state: "queued" as const }));
}

/** Fetch one tarball, counting bytes, and check it against the published sha512. */
async function fetchOne(base: string, pkg: RunPackage, dir: string, reporter: Reporter): Promise<string> {
  const m = await manifest(base, pkg.name, pkg.to);
  const tarball = m.dist?.tarball;
  const integrity = m.dist?.integrity;
  if (!tarball || !integrity?.startsWith("sha512-")) throw new Error(`${pkg.name}@${pkg.to}: no tarball or sha512 integrity published`);

  const res = await fetch(tarball, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`${pkg.name}@${pkg.to}: download answered ${res.status}`);
  const size = Number(res.headers.get("content-length")) || null;
  const file = path.join(dir, `${pkg.name.replace("/", "-").replace("@", "")}-${pkg.to}.tgz`);
  const out = createWriteStream(file);
  const hash = createHash("sha512");
  let received = 0;
  reporter.packageProgress(pkg.name, 0, size);
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    received += chunk.byteLength;
    if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    reporter.packageProgress(pkg.name, received, size ?? received + 1);
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  if (`sha512-${hash.digest("base64")}` !== integrity) {
    await fs.rm(file, { force: true });
    throw new Error(`${pkg.name}@${pkg.to}: the download does not match its published integrity hash`);
  }
  reporter.packageProgress(pkg.name, received, received);
  return file;
}

/**
 * Download every package, four at a time, then add them to npm's cache. Returns
 * false when something could not be fetched: the install then downloads it.
 */
export async function prefetch(packages: RunPackage[], reporter: Reporter): Promise<boolean> {
  const base = await registry();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xentium-prefetch-"));
  const files: string[] = [];
  let ok = true;
  try {
    const queue = [...packages];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let pkg = queue.shift(); pkg; pkg = queue.shift()) {
        try {
          files.push(await fetchOne(base, pkg, dir, reporter));
        } catch (e) {
          ok = false;
          reporter.log(`! ${(e as Error).message} (npm will fetch it in the install)`);
        }
      }
    }));
    for (const file of files) {
      const added = await exec("npm", ["cache", "add", file], { quiet: true, timeout: 60_000 });
      if (added.code !== 0) ok = false;
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return ok;
}
