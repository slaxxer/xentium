import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace packages — they ship raw TS (main: src/index.ts), which
  // production Node can't type-strip from node_modules. npm deps stay external.
  noExternal: [/^@xentium\//],
});
