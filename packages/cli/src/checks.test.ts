/**
 * Server checks that judge a command by whether it ran, not by what it printed.
 * `sudo -n true` prints nothing and `nginx -v` writes to stderr, so an empty
 * stdout must still count as success (rc.1 reported passwordless sudo as asking
 * for a password, and an installed nginx as missing).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const answers = new Map<string, { stdout: string; stderr: string } | Error>();

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: unknown) => void) => {
    const a = answers.get([cmd, ...args].join(" ")) ?? new Error("not found");
    if (a instanceof Error) cb(a); else cb(null, a);
  },
}));

const { checkNginx, checkSystemd } = await import("./checks.js");

beforeEach(() => answers.clear());

describe("checks that print nothing on stdout", () => {
  it("passwordless sudo is recognised", async () => {
    if (process.platform !== "linux" || process.getuid?.() === 0) return;
    answers.set("systemctl --version", { stdout: "systemd 255", stderr: "" });
    answers.set("sudo -n true", { stdout: "", stderr: "" });
    expect((await checkSystemd()).detail).toMatch(/passwordless sudo/);
    answers.delete("sudo -n true");
    expect((await checkSystemd()).status).toBe("warn");
  });

  it("nginx is found although its version goes to stderr", async () => {
    answers.set("nginx -v", { stdout: "", stderr: "nginx version: nginx/1.27.0" });
    expect((await checkNginx()).detail).toMatch(/^installed/);
    answers.clear();
    expect((await checkNginx()).detail).toMatch(/^not installed/);
  });
});
