/**
 * Shared by the installer test files: the app (guard + installer routes) and the
 * full database wipe they start every test from. Each file still mocks
 * runMigrations itself (vi.mock is per file).
 */
import express, { type Express } from "express";
import { prisma } from "../../infrastructure/db.js";
import { installGuard } from "../../shared/middleware/installGuard.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { installerRouter } from "./installer.routes.js";

export function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use(installGuard);
  app.use("/api/install", installerRouter);
  app.get("/api/protected", (_req, res) => res.json({ ok: true }));
  return app;
}

export async function resetDb() {
  // Guarded, not optional: this truncates EVERY table, and it used to do so to
  // whatever DATABASE_URL pointed at — which was the developer's own database until
  // `vitest.config.ts` repointed the suite. The check throws unless the database is
  // disposable, so a stray override fails loudly instead of deleting data.
  assertDisposableDatabase();

  // Truncate every app table (CASCADE handles FK order) so the reset is
  // order-independent and survives leftover data from other suites/e2e runs.
  // _prisma_migrations is preserved so the schema stays intact.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const ADMIN = { email: "admin@xentium.test", username: "root", password: "correct horse battery" };
export const SITE = { siteName: "Xentium Test", siteUrl: "https://test.local", locale: "en" };
