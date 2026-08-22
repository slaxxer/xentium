# @nodevo/plugin-sdk

**The authoring contract for Nodevo CMS plugins.**

```bash
pnpm add @nodevo/plugin-sdk@alpha
```

```ts
import type { PluginDefinition, PluginContext } from "@nodevo/plugin-sdk";

export default {
  id: "my-plugin",
  async onEnable(ctx: PluginContext) {
    await ctx.registerPermissions([
      { key: "myplugin.thing.create", label: "Create things", domain: "My Plugin" },
    ]);
    ctx.registerRoutes(router);
    ctx.registerSearchSource(mySearchSource);
    ctx.registerAcpPage({ section: "My Plugin", label: "Settings", path: "/admin/my-plugin" });
  },
} satisfies PluginDefinition;
```

A plugin runs inside the host process but reaches core only through this
contract — no unrestricted access to internals. `ctx.host` hands you what the
host already has (`prisma`, `queues`, `logger`, auth middleware), so a plugin
should **not** install `@nodevo/server-kit`, `@nodevo/auth` or
`@nodevo/plugin-engine`: those are already running, and your own copy would be a
second, unconnected instance.

## Layering

The application-agnostic half lives in
[`@nodevo/plugin-kit`](https://www.npmjs.com/package/@nodevo/plugin-kit) and is
re-exported here in full, so one import still gets you everything. The split
exists so a plugin for a different Nodevo-framework application has something to
build against that does not assume a CMS.

Full walkthrough: [Plugin development guide](https://github.com/slaxxer/nodevo#plugin-development-guide).

---

Part of the [Nodevo framework](https://github.com/slaxxer/nodevo).

MIT © Slaxxer
