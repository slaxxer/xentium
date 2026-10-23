import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImageProcessing, checkMemory, checkNode, checkPlatform, worst, type Check } from "./checks.js";
import { pgConnection, prismaBin, recordDeploy } from "./release.js";
import { compareSemver, mergeEnv, parseEnv } from "./site.js";
import { unitFile } from "./service.js";
import { logo } from "./ui.js";
import { Site } from "./site.js";

const check = (status: Check["status"]): Check => ({ key: "k", name: "n", status, detail: "d" });

describe("worst", () => {
  it("is the most serious status present", () => {
    expect(worst([check("ok"), check("ok")])).toBe("ok");
    expect(worst([check("ok"), check("warn")])).toBe("warn");
    expect(worst([check("warn"), check("fail"), check("ok")])).toBe("fail");
  });
});

describe("version checks", () => {
  it("refuses a Node below the minimum and warns below the recommended", () => {
    expect(checkNode("20.11.0").status).toBe("fail");
    expect(checkNode("22.12.0").status).toBe("warn");
    expect(checkNode("24.1.0").status).toBe("ok");
  });

  it("warns about a small machine rather than refusing it", () => {
    expect(checkMemory(512 * 1024 ** 2).status).toBe("warn");
    expect(checkMemory(4 * 1024 ** 3).status).toBe("ok");
  });

  it("never refuses a platform outright", () => {
    expect(checkPlatform().status).not.toBe("fail");
  });

  it("refuses a platform the image library has no binary for", () => {
    expect(checkImageProcessing("linux-x64").status).toBe("ok");
    expect(checkImageProcessing("linux-arm64").status).toBe("ok");
    expect(checkImageProcessing("freebsd-x64").status).toBe("fail");
  });
});

describe("pgConnection", () => {
  it("drops Prisma's own parameters, which pg_dump rejects", () => {
    const { url, schema } = pgConnection("postgresql://u:p@h:5432/db?schema=public&connection_limit=5");
    expect(url).toBe("postgresql://u:p@h:5432/db");
    expect(schema).toBeUndefined();
  });

  it("keeps libpq's parameters", () => {
    expect(pgConnection("postgresql://u:p@h:5432/db?sslmode=require&schema=public").url)
      .toBe("postgresql://u:p@h:5432/db?sslmode=require");
  });

  it("hands a non-default schema back as a flag instead of a parameter", () => {
    const { url, schema } = pgConnection("postgresql://u:p@h:5432/db?schema=forum");
    expect(url).toBe("postgresql://u:p@h:5432/db");
    expect(schema).toBe("forum");
  });

  it("leaves a key=value connection string alone", () => {
    expect(pgConnection("host=localhost dbname=xentium").url).toBe("host=localhost dbname=xentium");
  });
});

describe("mergeEnv", () => {
  it("replaces a value in place and keeps everything around it", () => {
    const before = "# mine\nPORT=4000\n\n# keep me\nAPP_URL=http://a\n";
    expect(mergeEnv(before, { PORT: "8080" })).toBe("# mine\nPORT=8080\n\n# keep me\nAPP_URL=http://a\n");
  });

  it("appends keys that aren't there yet", () => {
    expect(mergeEnv("PORT=4000\n", { DATA_DIR: "/data" })).toBe("PORT=4000\n\nDATA_DIR=/data\n");
  });

  it("round-trips through parseEnv", () => {
    expect(parseEnv(mergeEnv("", { A: "1", B: "two" }))).toEqual({ A: "1", B: "two" });
  });
});

describe("compareSemver", () => {
  it("orders releases numerically, not as text", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("puts a prerelease below its release", () => {
    expect(compareSemver("1.0.0-alpha.2", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.3", "1.0.0-alpha.2")).toBe(1);
    expect(compareSemver("1.0.0-alpha.10", "1.0.0-alpha.9")).toBe(1);
    expect(compareSemver("1.0.0-alpha.9", "1.0.0-alpha.10")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
  });
});

describe("systemd units", () => {
  const site = new Site("/srv/community");

  it("points the working directory through the current symlink, so a restart runs the new release", () => {
    expect(unitFile(site, "api", "xentium")).toContain("WorkingDirectory=/srv/community/current/node_modules/@xentium/server/apps/api");
  });

  it("tells the app where its config lives and lets it write only to shared/", () => {
    const unit = unitFile(site, "worker", "xentium");
    expect(unit).toContain("Environment=XENTIUM_ENV_FILE=/srv/community/shared/.env");
    expect(unit).toContain("ReadWritePaths=/srv/community/shared");
    expect(unit).toContain("dist/worker.js");
  });
});

describe("the Prisma CLI inside a release", () => {
  const bin = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const withRelease = (links: string[], body: (site: Site) => void) => {
    const root = mkdtempSync(path.join(tmpdir(), "xentium-rel-"));
    try {
      for (const dir of links) {
        const full = path.join(root, "releases", "1.0.0", dir);
        mkdirSync(full, { recursive: true });
        writeFileSync(path.join(full, bin), "");
      }
      body(new Site(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const nested = "node_modules/@xentium/server/node_modules/.bin";
  const hoisted = "node_modules/.bin";

  it("finds it under the package, where the published shrinkwrap makes npm put it", () => {
    withRelease([nested], (site) => {
      expect(prismaBin(site, "1.0.0")).toBe(path.join(site.releaseDir("1.0.0"), nested, bin));
    });
  });

  it("falls back to the release root when npm hoisted it", () => {
    withRelease([hoisted], (site) => {
      expect(prismaBin(site, "1.0.0")).toBe(path.join(site.releaseDir("1.0.0"), hoisted, bin));
    });
  });

  it("refuses rather than spawning a path that is not there", () => {
    withRelease([], (site) => {
      expect(() => prismaBin(site, "1.0.0")).toThrow(/no Prisma CLI/);
    });
  });
});

describe("the wordmark", () => {
  const capture = (columns: number | undefined): string => {
    const original = process.stdout.write.bind(process.stdout);
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    let out = "";
    Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
    process.stdout.write = ((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write;
    try {
      logo();
    } finally {
      process.stdout.write = original;
      if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    }
    return out;
  };

  // Built rather than written as a literal: a raw escape inside a regex is
  // exactly what no-control-regex is there to catch.
  const plain = (text: string) => text.replace(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g"), "");

  it("fits in an 80-column terminal, with the top row's indent intact", () => {
    const rows = plain(capture(80)).split("\n").filter((l) => l.includes("_") || l.includes("\\"));
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(78);
    expect(rows[0]!.startsWith("   __  __")).toBe(true);
  });

  it("gives a narrow terminal the name instead of five sheared lines", () => {
    expect(plain(capture(60))).toContain("Xentium");
    expect(plain(capture(60))).not.toContain("\\_\\");
  });
});

describe("recording a deploy", () => {
  it("is best effort: no database configured means false, never a thrown update", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xentium-record-"));
    try {
      mkdirSync(path.join(root, "shared"), { recursive: true });
      writeFileSync(path.join(root, "shared", ".env"), "PORT=4000\n");
      const at = new Date();
      await expect(recordDeploy(new Site(root), { status: "completed", version: "1.0.0", output: "", startedAt: at, completedAt: at }))
        .resolves.toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
