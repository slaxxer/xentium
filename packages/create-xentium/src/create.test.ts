import { describe, expect, it } from "vitest";
import { composeFile } from "./compose.js";

const setup = { databaseUrl: "", redisUrl: "", postgresPort: 5433, redisPort: 6380 };

describe("the Compose file we write", () => {
  const yaml = composeFile(setup, "xentium-my-site", "s3cret");

  it("publishes both services on localhost only", () => {
    expect(yaml).toContain('ports: ["127.0.0.1:5433:5432"]');
    expect(yaml).toContain('ports: ["127.0.0.1:6380:6379"]');
    expect(yaml).not.toMatch(/ports: \["\d+:\d+"\]/);
  });

  it("keeps the data in named volumes, so nothing in the site ends up root-owned", () => {
    expect(yaml).toContain('volumes: ["postgres-data:/var/lib/postgresql/data"]');
    expect(yaml).not.toContain("./postgres-data");
  });

  it("runs Redis with the only eviction policy BullMQ can keep jobs under", () => {
    expect(yaml).toContain('"--maxmemory-policy", "noeviction"');
  });

  it("uses the project name it was given", () => {
    expect(yaml).toContain("name: xentium-my-site");
  });
});
