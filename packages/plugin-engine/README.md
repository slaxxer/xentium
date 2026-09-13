# @nodevo/plugin-engine

**Plugin engine primitives for the Xentium framework.**

Manifest parsing and compatibility checking, the DDL-only SQL guard every
plugin migration is held to, and the in-memory registry and router.

`hostVersion` is an argument rather than an import, because a marketplace
validates a submission against a TARGET version rather than its own:

```ts
validateManifest(raw, "1.0.0");
createManifestValidator(hostVersion);          // bind it once

validateMigrationSql(sql, "001_init.up.sql");  // throws on any DML
```

---

Part of the [Xentium framework](https://github.com/slaxxer/nodevo). Xentium is a framework with the Xentium CMS as its first application.

MIT © Slaxxer
