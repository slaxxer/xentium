/**
 * THE CONTRACT FIXTURE: a plugin that uses every registration and every host
 * service core offers plugins (ADR-0011). `core/plugin-platform/contract.test.ts`
 * installs it through the real engine, uses it, and disables it.
 *
 * It is typed as a `PluginDefinition`, so a change to the SDK's shapes breaks the
 * typecheck here; and it runs, so a change to what core DOES with a registration
 * breaks the test. Either way we hear about it before a plugin developer does.
 *
 * When core offers something new to plugins, use it here too.
 */
import { Router } from "express";
import type { PluginDefinition } from "@xentium/plugin-sdk";

const ID = "plugin-contract";

/** What the fixture saw, for the test (the engine imports this module afresh, so state goes through globalThis). */
export interface ContractProbe { events: unknown[]; jobs: unknown[]; disabled: boolean }
const probe = (): ContractProbe => {
  const g = globalThis as { __pluginContract?: ContractProbe };
  return (g.__pluginContract ??= { events: [], jobs: [], disabled: false });
};

const definition: PluginDefinition = {
  id: ID,

  async onEnable(ctx) {
    const { host } = ctx;
    const z = host.zod;

    // ── Routes and permissions ──
    const router = Router();
    router.get("/ping", (_req, res) => { res.json({ ok: true }); });
    router.get("/whoami", host.middleware.requireAuth, async (req, res) => {
      const userId = (req as unknown as { userId: string }).userId;
      res.json({
        refs: await host.users.refs([userId]),
        canSeeSelf: await host.users.canSee(userId, userId, "profile"),
        zone: await host.time.zone(),
        today: await host.time.dayKey(),
        mayManage: await host.permissions.has(userId, `${ID}.manage`),
      });
    });
    router.get("/files", async (_req, res) => { res.json({ count: (await host.files.list()).length }); });
    ctx.registerRoutes(router);
    await ctx.registerPermissions([{ key: `${ID}.manage`, label: "Manage the contract fixture", domain: "Contract", defaults: ["admin"] }]);
    ctx.registerNecCodes([{ code: "XEC-CONTRACT-7001", msg: "Contract", sev: "Info", domain: "Contract", desc: "d", cause: "c", fix: "f" }]);

    // ── Where it shows ──
    await ctx.registerNavItem({ label: "Contract", url: "/contract" });
    ctx.registerAcpPage({ section: "extensions", label: "Contract", path: "/admin/contract" });
    ctx.registerNotificationTypes([`${ID}.ping`]);
    ctx.registerLayoutTemplate({
      key: `${ID}.index`, label: "Contract", regions: ["main"],
      defaultDocument: { templateKey: `${ID}.index`, regions: { main: [] } },
    });

    // ── Content core asks about ──
    ctx.registerSearchSource({ id: ID, label: "Contract", search: async () => ({ data: [], total: 0 }) });
    ctx.registerHomeFeedSource({ id: ID, label: "Contract", recent: async () => [] });
    ctx.registerStatSource({ id: ID, collect: async () => [{ id: "notes", label: "Notes", value: 0 }] });
    ctx.registerProgressionCriteria({ id: ID, evaluate: async () => [] });
    ctx.registerBadgeCriteria({ key: `${ID}.notes`, label: "Notes", valueFor: async () => 0 });
    ctx.registerContentKind({ kind: `${ID}.note`, canView: async (id) => id === "visible" });
    ctx.registerEmbed({ type: "contract-card", sync: async () => [], remove: async () => {} });
    ctx.registerReportTarget({ kind: `${ID}.note`, describe: async () => null });
    ctx.registerPageSource({ id: ID, area: "contract", label: "Contract", describe: async () => null });

    // ── Security and sign-in ──
    ctx.registerAuthGuard({ id: ID });
    ctx.registerSecurityScan(async () => {});
    ctx.claimSecurityPatterns([]);

    // ── Events, filters, jobs ──
    ctx.on("user.registered", (p) => { probe().events.push(p); });
    ctx.on(`${ID}.note.created`, (p) => { probe().events.push(p); });
    ctx.filter("registration.validate", (i) => (i.username === "contract_forbidden" ? { refuse: `${ID}:errors.forbidden` } : undefined));
    ctx.filter("profile.extra", ({ userId }) => ({ seen: userId }));
    ctx.registerJob({ name: "ping", handler: (data) => { probe().jobs.push(data); } });

    // ── Settings and data ──
    ctx.registerSettings({
      title: "Contract",
      schema: z.object({
        greeting: z.string().max(40).default("hello").meta({ title: "Greeting", public: true }),
        limit: z.number().int().min(1).max(10).default(3),
      }),
    });
    await ctx.registerResource({
      name: "notes", table: "pc_notes",
      schema: z.object({ title: z.string().min(1).max(100) }),
      owner: "author_id",
      access: { read: "public", create: "members", update: "own", delete: "own", manage: `${ID}.manage` },
      hooks: { afterCreate: (row) => { ctx.emit(`${ID}.note.created`, { id: row.id }); } },
    });
  },

  async onDisable() {
    probe().disabled = true;
  },
};

export default definition;
