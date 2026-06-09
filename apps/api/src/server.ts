import { createApp } from './app/app.js';
import { registerCorePermissions } from './bootstrap/registerCorePermissions.js';
import { bootstrapOfficialPlugins } from './bootstrap/bootstrapOfficialPlugins.js';
import { initializeEnabledPlugins } from './core/plugin-engine/plugin-engine.js';
import { adminService } from './modules/admin/admin.service.js';
import { env } from './config/env.js';

async function main() {
  console.log('🔧 Running bootstrap...');
  await registerCorePermissions();
  console.log('✅ Core permissions registered');

  await adminService.ensureMembersNavItem().catch(() => { /* install not finished yet */ });

  await bootstrapOfficialPlugins();
  console.log('✅ Official plugins bootstrapped');

  await initializeEnabledPlugins();
  console.log('✅ Plugin registry initialized');

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`🚀 API running on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n⏹️  Shutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('💥 Startup failed:', err);
  process.exit(1);
});
