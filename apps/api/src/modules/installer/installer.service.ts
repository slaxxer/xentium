import { prisma } from "../../infrastructure/db.js";
import { hashPassword } from "../auth/auth.password.js";
import { createSession } from "../auth/auth.tokens.js";
import { InstallStep, type InstallStatusDto } from "@xentium/contracts";
import { XENTIUM_VERSION } from "../../config/version.js";
import { environmentCheck } from "../../core/installer-engine/steps/environmentCheck.js";
import { databaseCheck } from "../../core/installer-engine/steps/databaseCheck.js";
import { runMigrations } from "../../core/installer-engine/steps/runMigrations.js";
import { seedCore } from "../../core/installer-engine/steps/seedCore.js";
import { finalize } from "../../core/installer-engine/steps/finalize.js";
import { ensureInstallRow, advanceTo, assertNotComplete, getInstall, requireStep, withInstallLock }
  from "../../core/installer-engine/installState.js";
import type {
  SiteConfigInput, AdminAccountInput, InstallAddonSelectionInput,
  InstallAddonsDto, InstallAddonInstallResult,
} from "@xentium/contracts";
import { getFreshSetting, bustSettingsCache } from "../../shared/utils/settings.js";

/** Which add-ons the wizard was told to install. Kept after the install as a
 *  record of what the site started with. */
const ADDON_SELECTION_KEY = "install.addons";

/** One page is the whole catalogue as far as this step is concerned — the wizard
 *  offers a starting set, the ACP is where an admin goes shopping. */
const ADDON_CATALOGUE_LIMIT = 24;

type Meta = { ip?: string; userAgent?: string; deviceCookieId?: string };

export const installerService = {
  async status(): Promise<InstallStatusDto> {
    const row = await getInstall().catch(() => null);
    return {
      installed: !!row?.completedAt,
      currentStep: (row?.currentStep as InstallStep) ?? InstallStep.WELCOME,
      siteId: row?.siteId ?? null,
      // The full app is running, so the pre-env setup server is gone. The
      // wizard polls this flag after POST /install/setup to detect the swap.
      setupMode: false,
      version: XENTIUM_VERSION,
    };
  },

  environment: () => environmentCheck(),

  /** Safe to run again (walking back, a retry after a failure): every part is idempotent. */
  configureDatabase: () => withInstallLock(async () => {
    await assertNotComplete();
    await databaseCheck(); // verify first
    await runMigrations(); // schema now exists
    await seedCore(); // perms + groups
    // Last: no install row until the schema and seeds are in, so a failure above
    // leaves an install that simply hasn't done this step yet.
    await ensureInstallRow(InstallStep.SITE_CONFIG);
    return { currentStep: InstallStep.SITE_CONFIG };
  }),

  async testDatabase() {
    await assertNotComplete();
    await databaseCheck(); // SELECT 1, no migration
    return { ok: true };
  },

  configureSite: (input: SiteConfigInput) => withInstallLock(async () => {
    await assertNotComplete();
    await requireStep(InstallStep.SITE_CONFIG);
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: "site.name" },
        update: { value: input.siteName },
        create: { key: "site.name", value: input.siteName },
      }),
      prisma.setting.upsert({
        where: { key: "site.url" },
        update: { value: input.siteUrl },
        create: { key: "site.url", value: input.siteUrl },
      }),
      prisma.setting.upsert({
        where: { key: "site.locale" },
        update: { value: input.locale },
        create: { key: "site.locale", value: input.locale },
      }),
      // Add this block:
      prisma.setting.upsert({
        where: { key: "site.timezone" },
        update: { value: input.timezone },
        create: { key: "site.timezone", value: input.timezone },
      }),
    ]);
    await advanceTo(InstallStep.ADDONS);
    return { currentStep: InstallStep.ADDONS };
  }),

  // ── ADD-ONS ────────────────────────────────────────────────────────────────

  /**
   * Everything the add-ons step draws, in one call.
   *
   * Every marketplace call is best-effort: an install must not be blocked by a
   * storefront being down, on a box with no outbound network, or by an operator
   * pointing LICENSE_SERVER_URL at nothing. `reachable: false` is a state the
   * step renders, not an error it throws.
   */
  async addons(): Promise<InstallAddonsDto> {
    await assertNotComplete();
    await requireStep(InstallStep.ADDONS);
    const { marketplaceService } = await import("../admin/marketplace.service.js");

    // Fresh, not cached: the step is re-entered by walking back through the
    // wizard, moments after the previous pass wrote it.
    const selected = (await getFreshSetting<string[]>(ADDON_SELECTION_KEY, [])) ?? [];

    const connection = await marketplaceService.getConnection().catch(() => null);
    const connected = !!connection?.connected;

    // One page is the catalogue as far as this step is concerned: the wizard
    // offers a starting set, not a storefront to browse. The ACP is where an
    // admin goes shopping.
    const page = await marketplaceService
      .listPlugins({ page: 1, limit: ADDON_CATALOGUE_LIMIT, order: "desc" })
      .catch(() => null);

    // `listPlugins` swallows an unreachable marketplace into an empty page, so
    // "no listings and not connected" is the only signal we get. Treat a
    // genuinely empty catalogue the same way — the step says the same sentence
    // either way, and there is nothing to choose in both cases.
    const listings = page?.data ?? [];

    // Deduped: an account can hold several licences for the same product (a
    // renewal, a second seat), and the step counts this list as "licences you
    // can use here" — three rows for one plugin would read as three add-ons.
    const ownedIds = connected
      ? await marketplaceService
          .listOwned()
          .then((r) => [...new Set(
            r.licenses.filter((l) => l.product.kind === "plugin").map((l) => l.product.id),
          )])
          .catch(() => [])
      : [];

    return {
      reachable: listings.length > 0,
      connected,
      accountRef: connection?.accountRef ?? null,
      listings,
      ownedIds,
      selected,
    };
  },

  /** Record the choice and move on. Nothing is downloaded yet — the artifacts
   *  are fetched during the install run, once there is an admin to attribute
   *  them to. */
  selectAddons: (input: InstallAddonSelectionInput) => withInstallLock(async () => {
    await assertNotComplete();
    await requireStep(InstallStep.ADDONS);
    await prisma.setting.upsert({
      where:  { key: ADDON_SELECTION_KEY },
      update: { value: input.pluginIds },
      create: { key: ADDON_SELECTION_KEY, value: input.pluginIds },
    });
    bustSettingsCache(ADDON_SELECTION_KEY);
    await advanceTo(InstallStep.ADMIN);
    return { currentStep: InstallStep.ADMIN, selected: input.pluginIds };
  }),

  /**
   * Install ONE chosen add-on, then enable it.
   *
   * One call per add-on rather than one call for the list: the wizard prints a
   * line per package as it lands, and a single call that fails halfway would
   * have to invent a way to say which ones made it. This also keeps the install
   * path identical to the ACP's — same download gate, same intake, same
   * attribution.
   *
   * Enabling is part of the job here. The ACP deliberately lands a plugin
   * DISABLED because an admin installing one is not necessarily ready to run
   * it; someone who ticked "Forum" in the installer very much is.
   */
  async installAddon(pluginId: string, version: string, userId: string): Promise<InstallAddonInstallResult> {
    await assertNotComplete();
    await requireStep(InstallStep.FINALIZE);
    const { marketplaceService } = await import("../admin/marketplace.service.js");
    const { pluginService } = await import("../plugins/plugin.service.js");

    const installed = await marketplaceService.installFromMarketplace(pluginId, version, userId);

    // A refusal here is a licence the marketplace declined at the enable gate,
    // not a broken install: the package is on disk and the ACP can enable it
    // once the licence is sorted. Failing the whole wizard over it would be
    // worse than saying so.
    let enabled = true;
    try {
      await pluginService.enable(installed.id);
    } catch {
      enabled = false;
    }
    return { ...installed, enabled };
  },

  // ── Marketplace account link, during the install ───────────────────────────
  //
  // The same one-click handshake the ACP runs, reached before there is an admin
  // to authenticate. What guards it is the installer itself: these routes exist
  // only while the install is unfinished, and anyone who can reach an unfinished
  // installer can create its administrator anyway — which is a strictly larger
  // power than linking an account they already hold the credentials for. The
  // poll secret stays server-side here exactly as it does in the ACP.

  async startMarketplaceLink() {
    await assertNotComplete();
    await requireStep(InstallStep.ADDONS);
    const { marketplaceService } = await import("../admin/marketplace.service.js");
    return marketplaceService.startLink();
  },

  async pollMarketplaceLink(linkId: string) {
    await assertNotComplete();
    await requireStep(InstallStep.ADDONS);
    const { marketplaceService } = await import("../admin/marketplace.service.js");
    return marketplaceService.pollLink(linkId);
  },

  async unlinkMarketplace() {
    await assertNotComplete();
    await requireStep(InstallStep.ADDONS);
    const { marketplaceService } = await import("../admin/marketplace.service.js");
    await marketplaceService.disconnect();
    return { ok: true };
  },

  /** Also the retry of a failed install run, so it is allowed again at FINALIZE. */
  createAdmin: (input: AdminAccountInput, meta: Meta) => withInstallLock(async () => {
    await assertNotComplete();
    await requireStep(InstallStep.ADMIN);
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.$transaction(async (tx) => {
      const admin = await tx.group.findUniqueOrThrow({ where: { key: "admin" } });
      const u = await tx.user.upsert({
        where: { email: input.email },
        update: { username: input.username, passwordHash },
        create: { email: input.email, username: input.username, passwordHash, isActive: true },
      });
      await tx.userGroup.upsert({
        where: { userId_groupId: { userId: u.id, groupId: admin.id } },
        update: {},
        create: { userId: u.id, groupId: admin.id },
      });
      return u;
    });
    await advanceTo(InstallStep.FINALIZE);
    // Issue a session immediately so the browser gets a refresh cookie —
    // the admin is logged in as soon as installation completes.
    const tokens = await createSession(user.id, meta);
    return { currentStep: InstallStep.FINALIZE, ...tokens };
  }),

  finalize: () => withInstallLock(async () => {
    await assertNotComplete();
    await requireStep(InstallStep.FINALIZE);
    const { siteId } = await finalize();
    return { currentStep: InstallStep.COMPLETE, siteId };
  }),
};
