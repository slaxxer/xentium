# @xentium/plugin-kit

**The application-agnostic half of the Xentium plugin contract.**

Manifest, definition, host bridge and the base context — the shapes a plugin and
its host agree on, with nothing in them that assumes a CMS.

## Which package do you want?

**Almost certainly [`@xentium/plugin-sdk`](https://www.npmjs.com/package/@xentium/plugin-sdk).**
It re-exports this package in full and adds the Xentium CMS surface (search
sources, home feeds, progression, layout templates, ACP pages), so a CMS plugin
gets everything from one import.

Reach for this package directly only when writing a plugin for a *different*
Xentium-framework application, or tooling that handles plugins for any host.

```ts
import type { PluginDefinition, PluginContext } from "@xentium/plugin-kit";

export default {
  id: "my-plugin",
  async onEnable(ctx: PluginContext) {
    await ctx.registerPermissions([
      { key: "myplugin.thing.create", label: "Create things", domain: "My Plugin" },
    ]);
    ctx.registerRoutes(router);
  },
} satisfies PluginDefinition;
```

`PluginContext` and `PluginDefinition` are generic over the host bridge and the
context, which is how an application layers its own registrations on without
this package knowing they exist.

---

Part of the [Xentium framework](https://github.com/slaxxer/xentium).

MIT © Slaxxer
