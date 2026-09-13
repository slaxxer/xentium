import { runAdapterCli } from "@xentium/migrate-core";
import { phpbbAdapter } from "./index.js";

// CLI entry:
//   pnpm --filter @xentium/migrate-phpbb migrate -- \
//     --source-db "mysql://user:pass@host/phpbb" [--prefix phpbb_] \
//     --db "postgresql://…" [--dry-run] [--yes]
runAdapterCli(phpbbAdapter, process.argv.slice(2)).catch((err) => {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exit(1);
});
