import { defineConfig } from "vitest/config";

/**
 * The API suite runs against a THROWAWAY database, never the development one.
 *
 * `installer.test.ts` truncates every table — it has to, since it asserts the install
 * wizard from empty — and until this config existed it did that to whatever
 * `DATABASE_URL` in the repo-root `.env` pointed at, i.e. the developer's own data.
 *
 * `globalSetup` creates `<devdb>_test` and migrates it once per run; `setupFiles`
 * repoints `DATABASE_URL` inside every worker before any module reads env. The
 * destructive helper in `src/test/testDatabase.ts` independently refuses to wipe a
 * database whose name does not end in `_test`, so a stray override fails loudly
 * instead of quietly deleting.
 */
export default defineConfig({
  test: {
    globalSetup: ["src/test/globalSetup.ts"],
    setupFiles: ["src/test/setupEnv.ts"],
    // The suite shares one database, and the installer test truncates it. Parallel
    // files would wipe each other's fixtures mid-assertion.
    fileParallelism: false,
  },
});
