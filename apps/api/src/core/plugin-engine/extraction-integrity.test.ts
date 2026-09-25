/**
 * The check that runs every boot.
 *
 * Two failure directions, and they pull against each other:
 *
 *   - MISSING A TAMPER means running code someone edited after we verified it.
 *   - A FALSE POSITIVE means a working plugin refuses to load on a boot nobody
 *     asked for, which for a forum is an outage.
 *
 * The second is the one that will actually happen if this is written carelessly,
 * so most of these tests are about things that must NOT be reported: a plugin
 * writing a cache file beside itself, the engine's own node_modules link, a
 * package that is simply gone.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

vi.mock("../../infrastructure/logging/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}));

const { checkExtractionIntegrity, assertExtractionIntact } = await import("./extraction-integrity.js");

const FILES: Record<string, string> = {
  "manifest.json": '{"id":"demo","version":"1.0.0"}',
  "server/dist/index.js": "export function onEnable() {}\n",
  "web/dist/index.js": "export default {};\n",
};

/** A package on disk plus its extraction, the way the engine leaves them. */
async function scenario(mutate?: (dir: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "xt-integrity-"));
  const pkg = path.join(root, "demo-1.0.0.xtplugin");
  const dir = path.join(root, "demo");

  const zip = new AdmZip();
  for (const [p, body] of Object.entries(FILES)) zip.addFile(p, Buffer.from(body, "utf8"));
  zip.writeZip(pkg);

  for (const [p, body] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), body, "utf8");
  }

  await mutate?.(dir);
  return { root, pkg, dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("checkExtractionIntegrity", () => {
  it("passes an untouched extraction", async () => {
    const s = await scenario();
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r).toEqual({ changed: [], missing: [], checked: true });
    await s.cleanup();
  });

  it("catches a shipped file that was edited", async () => {
    const s = await scenario(async (dir) => {
      await writeFile(path.join(dir, "server/dist/index.js"), "export function onEnable() { steal(); }\n", "utf8");
    });
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r.changed).toEqual(["server/dist/index.js"]);
    await s.cleanup();
  });

  it("catches a shipped file that was deleted", async () => {
    const s = await scenario(async (dir) => { await rm(path.join(dir, "web/dist/index.js")); });
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r.missing).toEqual(["web/dist/index.js"]);
    await s.cleanup();
  });

  it("ignores a file the plugin wrote beside itself", async () => {
    // A plugin caching something in its own directory is normal. Reporting it
    // would disable a working plugin on the next boot.
    const s = await scenario(async (dir) => {
      await writeFile(path.join(dir, "cache.json"), "{}", "utf8");
    });
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r.changed).toEqual([]);
    expect(r.missing).toEqual([]);
    await s.cleanup();
  });

  it("ignores a node_modules link the engine put there", async () => {
    const s = await scenario(async (dir) => {
      await symlink(path.join(dir, ".."), path.join(dir, "node_modules")).catch(() => {});
    });
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r.changed).toEqual([]);
    await s.cleanup();
  });

  it("reports 'not checked' when the package is gone, rather than guessing", async () => {
    // "We do not know" must not be dressed up as fine OR as compromised.
    const s = await scenario();
    await rm(s.pkg);
    const r = await checkExtractionIntegrity(s.pkg, s.dir);
    expect(r).toEqual({ changed: [], missing: [], checked: false });
    await s.cleanup();
  });
});

describe("assertExtractionIntact", () => {
  it("allows an untouched plugin to load", async () => {
    const s = await scenario();
    expect(await assertExtractionIntact("demo", s.pkg, s.dir)).toBeNull();
    await s.cleanup();
  });

  it("allows a plugin it cannot check to load", async () => {
    const s = await scenario();
    await rm(s.pkg);
    expect(await assertExtractionIntact("demo", s.pkg, s.dir)).toBeNull();
    await s.cleanup();
  });

  it("names the files that moved, because the admin has to act on it", async () => {
    const s = await scenario(async (dir) => {
      await writeFile(path.join(dir, "server/dist/index.js"), "tampered\n", "utf8");
    });
    const msg = await assertExtractionIntact("demo", s.pkg, s.dir);
    expect(msg).toContain("server/dist/index.js");
    expect(msg).toContain("not been loaded");
    await s.cleanup();
  });
});
