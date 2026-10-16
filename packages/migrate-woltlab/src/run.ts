import { runAdapterCli } from "@xentium/migrate-core";
import { woltlabAdapter } from "./index.js";

// CLI entry:
//   pnpm --filter @xentium/migrate-woltlab migrate -- \
//     --source-db "mysql://user:pass@host/woltlab" [--prefix 1] \
//     --db "postgresql://…" [--dry-run] [--yes]
runAdapterCli(woltlabAdapter, process.argv.slice(2)).catch((err) => {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exit(1);
});
