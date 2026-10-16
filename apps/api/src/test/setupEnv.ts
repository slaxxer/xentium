/**
 * Points each test worker at the throwaway database, before anything reads env.
 *
 * Ordering is the whole point. `config/env.ts` calls `dotenv.config()` at import,
 * and dotenv does **not** overwrite variables already present in the environment —
 * so setting `DATABASE_URL` here, in a setup file that runs before any test module is
 * imported, is what makes the rest of the app see the test database. Doing it in
 * `globalSetup` would not: that runs in vitest's main process, and workers do not
 * reliably inherit mutations made there.
 *
 * This file must not import anything that reads env at module load, or the value
 * would be captured before the assignment below.
 */
import os from "node:os";
import path from "node:path";
import { loadRootEnv, resolveTestDatabaseUrl } from "./testDatabase.js";

loadRootEnv();

process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Files too: the tests write real uploads (emojis, badges, the installer's seeds), and
// against the developer's `var/uploads` they left orphans there, or deleted files the
// development database still points at.
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "xentium-test-uploads");

// Some code paths relax behaviour for tests (rate limits, dev shortcuts); make the
// mode explicit rather than inheriting whatever the shell had.
process.env.NODE_ENV = "test";
