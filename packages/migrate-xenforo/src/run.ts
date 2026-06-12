import { runAdapterCli } from "@nodevo/migrate-core";
import { xenforoAdapter } from "./index.js";

// CLI entry:
//   pnpm --filter @nodevo/migrate-xenforo migrate -- \
//     --source-db "mysql://user:pass@host/xenforo" [--prefix xf_] \
//     --db "postgresql://…" [--dry-run] [--yes]
runAdapterCli(xenforoAdapter, process.argv.slice(2)).catch((err) => {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exit(1);
});
