import { defineConfig } from "tsup";

// One file, runnable with plain node. SYSTEM_REQUIREMENTS is bundled in from
// packages/contracts/src/system.ts, so the published CLI never waits on a contracts
// release to know the current minimums. `pg` stays a normal dependency.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["pg"],
});
