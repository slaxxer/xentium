import { loadEnvFileIntoProcess, missingRequiredEnv } from './config/envProbe.js';

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
    // Setup mode cannot import env.ts (that is the module whose exit it exists
    // to avoid), so nothing else would read the .env file — and an install that
    // wrote PORT=4411 would then be greeted by a wizard on :4000. The keys are
    // assigned without overriding, exactly as dotenv would.
    loadEnvFileIntoProcess();

    // An installer (`npm create xentium`) already asked for the database and
    // wrote it. Everything else that's missing is a secret we generate
    // ourselves, so there is nothing to ask a human — generate them and boot
    // the real app, and the wizard starts at the site step instead of asking
    // for database credentials a second time.
    if (!missing.includes('DATABASE_URL')) {
      console.log(`Generating ${missing.join(', ')}`);
      const { writeEnvConfig } = await import('./core/installer-engine/steps/writeConfig.js');
      await writeEnvConfig({ databaseUrl: process.env.DATABASE_URL! });
      const { boot } = await import('./boot.js');
      await boot();
      return;
    }

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
