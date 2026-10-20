import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { InstallStep, INSTALL_STEP_ORDER } from "@xentium/contracts";

/**
 * The install's one row and the rules for moving it along.
 *
 * - There is exactly one row: `singleton` is unique and always true, so a second
 *   insert fails in the database instead of minting a second siteId.
 * - The step only moves forward. Walking back through the wizard and submitting an
 *   earlier step again is allowed, and leaves the stored step where it was.
 * - An action may run once the install has reached its step (`requireStep`), so
 *   steps can't be skipped: no admin before the site, no finalize before an admin.
 * - Every action that changes something runs under `withInstallLock`, one at a time.
 */

const SINGLETON = { singleton: true } as const;
const rank = (step: string) => INSTALL_STEP_ORDER.indexOf(step as InstallStep);

/** The error shape the installer controller turns into `{ error }` with this status. */
function installError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export async function getInstall() {
  return prisma.install.findUnique({ where: SINGLETON });
}

/**
 * The siteId is minted HERE rather than in finalize, because the ADD-ONS step
 * talks to the marketplace and `getSiteId()` is what a licence binds to — an
 * install that cannot name itself cannot link an account or pass the download
 * gate. Minting it at row creation gives every install its own identity from
 * the DATABASE step onward, which is the hazard that guard was written for; a
 * half-finished install simply has a real id like any other.
 *
 * finalize still reads `row.siteId ?? randomUUID()`, so a row created before
 * this change (a resumed install) still gets one.
 */
export async function ensureInstallRow(step: InstallStep) {
  try {
    return await prisma.install.upsert({
      where:  SINGLETON,
      update: {},
      create: { currentStep: step, siteId: randomUUID() },
    });
  } catch (err) {
    // Lost an insert race to another process: the row exists now, use it.
    const row = await getInstall();
    if (row) return row;
    throw err;
  }
}

/** Move to `step`, never backwards. */
export async function advanceTo(step: InstallStep): Promise<void> {
  const earlier = INSTALL_STEP_ORDER.slice(0, rank(step));
  const { count } = await prisma.install.updateMany({
    where: { ...SINGLETON, currentStep: { in: earlier } },
    data:  { currentStep: step },
  });
  if (count === 0 && !(await getInstall())) throw installError("install_row_missing", 409);
}

/** Refuse an action whose step the install hasn't reached yet. */
export async function requireStep(step: InstallStep): Promise<void> {
  const row = await getInstall().catch(() => null);
  if (!row || rank(row.currentStep) < rank(step)) throw installError("install_step_out_of_order", 409);
}

export async function assertNotComplete() {
  let row;
  try {
    row = await getInstall();
  } catch {
    // Fresh database: the installs table doesn't exist until the DATABASE
    // step runs `migrate deploy`. No table = definitely not complete.
    return;
  }
  if (row?.completedAt) throw installError("already_installed", 410);
}

// Any constant: it only has to differ from the keys other code locks on
// (Prisma's migrate lock is 72707369).
const INSTALL_LOCK_KEY = 7_302_116;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Run one installer action at a time. In this process a queue keeps waiters off
 * the connection pool; across processes a transaction-scoped advisory lock does
 * the same, and Postgres releases it however the action ends.
 */
export function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INSTALL_LOCK_KEY})`;
      return fn();
    }, { maxWait: 10_000, timeout: 180_000 }),
  );
  queue = run.catch(() => undefined);
  return run;
}
