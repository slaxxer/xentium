import { missingRequiredEnv } from './config/envProbe.js';

/**
 * Boot gate (WordPress-style first run):
 *
 * Every hard crash on a fresh clone is module-load-time — env.ts exits on
 * missing required vars, prisma/redis/auth-secrets instantiate on import. So
 * nothing from the main app is imported statically here. If env is incomplete
 * we start a tiny setup server instead; the install wizard collects DB creds,
 * writes .env (with generated secrets) into process.env + disk, and then this
 * process dynamically imports boot.js — the whole app evaluates for the first
 * time with complete env. No restart needed.
 */
async function main() {
  const missing = missingRequiredEnv();

  if (missing.length > 0) {
    console.log(`Setup mode — missing env: ${missing.join(', ')}`);
    console.log('Open the site in a browser to run the install wizard.');
    const { startSetupServer } = await import('./setup/setupServer.js');
    await startSetupServer({
      onComplete: async () => {
        const { boot } = await import('./boot.js');
        await boot();
      },
    });
  } else {
    const { boot } = await import('./boot.js');
    await boot();
  }
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
