/**
 * The plugin store's node_modules link follows the running release.
 *
 * An update installs a new release beside the old one. Until rc.2 a link made
 * before it was kept, so plugins resolved express (and every other shared
 * package) from the OLD release while core ran the new one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { ensureHostModulesLink } = await import("./plugin-engine.js");

let root = "";
let store = "";
const release = (v: string) => path.join(root, "releases", v, "node_modules");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "xt-hostlink-"));
  store = path.join(root, "plugins");
  await mkdir(store, { recursive: true });
  await mkdir(release("old"), { recursive: true });
  await mkdir(release("new"), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("the plugin store's node_modules link", () => {
  it("is created when missing", async () => {
    await ensureHostModulesLink(store, release("new"));
    expect(await readlink(path.join(store, "node_modules"))).toBe(release("new"));
  });

  it("moves to the new release after an update", async () => {
    await symlink(release("old"), path.join(store, "node_modules"));
    await ensureHostModulesLink(store, release("new"));
    expect(await readlink(path.join(store, "node_modules"))).toBe(release("new"));
  });

  it("is re-made when it dangles", async () => {
    await symlink(path.join(root, "releases", "gone", "node_modules"), path.join(store, "node_modules"));
    await ensureHostModulesLink(store, release("new"));
    expect(await readlink(path.join(store, "node_modules"))).toBe(release("new"));
  });

  it("leaves a real directory alone", async () => {
    await mkdir(path.join(store, "node_modules"));
    await writeFile(path.join(store, "node_modules", "keep"), "");
    await ensureHostModulesLink(store, release("new"));
    await expect(readlink(path.join(store, "node_modules"))).rejects.toThrow();
  });
});
