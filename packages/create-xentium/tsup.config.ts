import { defineConfig } from "tsup";

// One file, no runtime resolution of anything of ours: the checks and the
// release installer are bundled from packages/cli/src, because the preflight has
// to run on a machine where nothing of ours is installed yet. `pg` stays a
// normal dependency (the database check needs a real driver).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  external: ["pg"],
});
