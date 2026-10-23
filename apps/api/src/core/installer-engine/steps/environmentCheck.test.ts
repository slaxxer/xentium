import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// A data directory that does not exist yet, two levels down: a fresh server.
const root = mkdtempSync(path.join(os.tmpdir(), "xt-envcheck-"));
const freshDataDir = path.join(root, "not", "yet");

vi.mock("../../../config/env.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../config/env.js")>();
  return { ...real, env: { ...real.env, DATA_DIR: freshDataDir } };
});

const { environmentCheck, nearestExistingDir } = await import("./environmentCheck.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("environment check", () => {
  it("finds the closest directory that exists", async () => {
    expect(await nearestExistingDir(path.join(root, "a", "b", "c"))).toBe(root);
    expect(await nearestExistingDir(root)).toBe(root);
  });

  it("passes the disk check on a fresh server, while the data directory is still being made", async () => {
    expect(existsSync(freshDataDir)).toBe(false);
    const { checks } = await environmentCheck();
    const storage = checks.find((c) => c.key === "storage")!;
    expect(storage.detail).not.toBe("Could not read disk");
    expect(storage.ok).toBe(true);
    // The directory check made it, as before.
    expect(checks.find((c) => c.key === "data_dir")!.ok).toBe(true);
  });
});
