# @nodevo/server-kit

**Server utilities for the Xentium framework.**

Settings with an in-process TTL cache, the list-endpoint pagination pattern,
encryption-at-rest for stored secrets, Redis-backed rate limiting, magic-byte
upload validation, and filesystem storage with traversal guards.

Everything with a dependency is a factory — nothing reaches for a module
singleton, which is also why all of it is testable without a database:

```ts
const settings = createSettings({
  get:     (key)  => db.setting.findUnique({ where: { key } }),
  getMany: (keys) => db.setting.findMany({ where: { key: { in: keys } } }),
});
```

---

Part of the [Xentium framework](https://github.com/slaxxer/nodevo). Xentium is a framework with the Xentium CMS as its first application.

MIT © Slaxxer
