import { runAdapterCli } from "@xentium/migrate-core";
import { vbulletinAdapter } from "./index.js";

// CLI entry:
//   pnpm --filter @xentium/migrate-vbulletin migrate -- \
//     --source-db "mysql://user:pass@host/vbulletin" [--prefix vb_] \
//     --db "postgresql://…" [--dry-run] [--yes]
runAdapterCli(vbulletinAdapter, process.argv.slice(2)).catch((err) => {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exit(1);
});
