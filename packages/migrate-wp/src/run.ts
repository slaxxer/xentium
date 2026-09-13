import { runAdapterCli } from "@xentium/migrate-core";
import { wordpressAdapter } from "./index.js";

// CLI entry: pnpm --filter @xentium/migrate-wp migrate -- --file export.xml --db postgresql://…
runAdapterCli(wordpressAdapter, process.argv.slice(2)).catch((err) => {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exit(1);
});
