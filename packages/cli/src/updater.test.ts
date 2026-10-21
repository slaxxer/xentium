/**
 * The pieces the one-click update leans on: what the updater accepts from the
 * web process, the status file the ACP reads, and the system files
 * install-service writes. The web process can only ask; these decide what runs.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileReporter, type RunStatus } from "./progress.js";
import { parseRequest } from "./updater.js";
import { updaterSudoers, updaterUnitFiles } from "./service.js";
import { Site } from "./site.js";

const by = { id: "u1", username: "Slaxxer" };
const ok = (r: object) => JSON.stringify({ v: 1, id: "run-12345678", requestedBy: by, requestedAt: "2026-10-21T00:00:00Z", ...r });

describe("update requests", () => {
  it("takes an update to a real version and a rollback", () => {
    expect(parseRequest(ok({ action: "update", version: "1.0.0-alpha.18" }))).toMatchObject({ request: { action: "update", version: "1.0.0-alpha.18" } });
    expect(parseRequest(ok({ action: "rollback" }))).toMatchObject({ request: { action: "rollback" } });
  });

  it("refuses anything that could become a command", () => {
    for (const bad of [
      ok({ action: "update", version: "latest" }),
      ok({ action: "update", version: "1.0.0; rm -rf /" }),
      ok({ action: "update", version: "file:../evil.tgz" }),
      ok({ action: "update" }),
      ok({ action: "exec", version: "1.0.0" }),
      JSON.stringify({ v: 1, id: "../../x", action: "update", version: "1.0.0", requestedBy: by }),
      ok({ action: "update", version: "1.0.0", requestedBy: null }),
      "not json",
    ]) expect(parseRequest(bad)).toHaveProperty("reason");
  });
});

describe("status file", () => {
  it("writes steps, packages and migrations, and the hand-over keeps the run", async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "xt-status-")), "update-status.json");
    const base = { id: "run-12345678", action: "update" as const, from: "1.0.0-alpha.17", to: "1.0.0-alpha.18", requestedBy: by, startedAt: "2026-10-21T00:00:00Z" };
    const first = FileReporter.open(file, base);
    first.step("cli", "running");
    first.step("cli", "done");
    await first.settle();

    // The new CLI opens the same run and carries on.
    const second = FileReporter.open(file, base);
    second.packages([{ name: "@xentium/server", from: "1.0.0-alpha.17", to: "1.0.0-alpha.18", size: null, received: 0, state: "queued" }]);
    second.packageProgress("@xentium/server", 500, 1000);
    second.packageProgress("@xentium/server", 1000, 1000);
    second.migrations(["20261101000000_example"]);
    second.migration("20261101000000_example", "done");
    second.step("health", "running");
    await second.finish("done");

    const s = JSON.parse(readFileSync(file, "utf8")) as RunStatus;
    expect(s.steps.find((x) => x.key === "cli")?.state).toBe("done");
    expect(s.packages[0]).toMatchObject({ received: 1000, size: 1000, state: "done" });
    expect(s.migrations[0]?.state).toBe("done");
    expect(s.state).toBe("done");
    expect(s.steps.find((x) => x.key === "health")?.state).toBe("done"); // left running → closed
    expect(s.finishedAt).not.toBeNull();
  });
});

describe("system files", () => {
  const units = { api: "xentium-api", worker: "xentium-worker" };

  it("lets the site's user start and stop exactly its two units", () => {
    const rule = updaterSudoers("ubuntu", units, "/usr/bin/systemctl");
    expect(rule).toContain("ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl start xentium-api.service xentium-worker.service,");
    expect(rule).not.toMatch(/NOPASSWD:\s*ALL/);
    expect(rule.match(/\/usr\/bin\/systemctl/g)).toHaveLength(3);
  });

  it("runs the updater as the site's user, on the request file", () => {
    const site = new Site("/srv/xentium");
    const files = updaterUnitFiles(site, "ubuntu", units);
    expect(files.path).toContain("PathExists=/srv/xentium/shared/run/update-request.json");
    expect(files.service).toContain("User=ubuntu");
    expect(files.service).toContain("Type=oneshot");
    expect(files.service).toContain("updater --site /srv/xentium");
  });
});
