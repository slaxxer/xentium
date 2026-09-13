# Plugin extension points

Everything a plugin can contribute to core, in one place. All of it is registered from
`onEnable(ctx)` and dropped again on disable.

```ts
export default definePlugin({
  async onEnable(ctx) {
    ctx.registerStatSource({ id: "forum", collect: () => … });
  },
});
```

Two rules hold for every registry below, and they are the reason plugins can be
disabled safely:

⚠ **Registration is not persistence.** A registry is in-memory and rebuilt on boot.
Core re-enables every enabled plugin before the server listens, so a registry is
complete by the time a request can arrive — but nothing a plugin registers survives
a disable, and nothing should need to.

⚠ **Disabling drops the contribution, never the admin's data.** A threshold stored
against a metric whose plugin is gone is *skipped*, not deleted, and counts again the
day the plugin comes back. The same rule as unknown block types in a layout: skipped
and kept.

---

## Routes and permissions

### `registerRoutes(router)`

An Express router, mounted at `/api/p/<your-plugin-id>/…`.

```ts
const r = Router();
r.get("/threads", ctx.host.middleware.optionalAuth, handler);
ctx.registerRoutes(r);
```

⚠ Core injects an **enabled check** in front of it: while your plugin is disabled every
one of its routes answers `404 NEC-PLUGIN-2020`, without your code running. A route
cannot outlive the plugin that registered it — so never point core UI at a plugin route
without handling its absence.

⚠ Use the host's `middleware` (`requireAuth`, `optionalAuth`, `requirePermission`), not
your own token parsing: `req.userId` is what the rest of the platform means by the
caller.

### `registerPermissions(perms)`

```ts
await ctx.registerPermissions([{
  key:      "forum.thread.create",   // domain.action, namespaced to your plugin
  label:    "Create threads",
  domain:   "Forum",                 // grouping in the ACP's permission matrix
  defaults: ["member", "moderator"], // GROUP KEYS, not ids
}]);
```

Upserted by key, so shipping a new key in an update is just declaring it — the `label`
is refreshed and existing grants are untouched.

⚠ `defaults` are **re-asserted on every boot**, not granted once: `onEnable` runs for
every enabled plugin at startup, and the grant is an upsert. Treat them as "this group
always has this", and keep anything an admin is meant to be able to take away out of the
list. (Known deviation from the intended first-install-only behaviour — see `BUGS.md`.)

---

## Data sources

### `registerSearchSource(source)`

A tab in site search.

```ts
ctx.registerSearchSource({
  id:         "forum",
  label:      "Threads",
  permission: null,                 // null = public; otherwise a permission key
  async search(query, { isLoggedIn, page, limit }) {
    return { data: [...], total: 0 };
  },
});
```

⚠ `permission` is enforced by core before `search` is called, but the plugin still owns
row-level access — core cannot know which of your rows this viewer may see.

### `registerHomeFeedSource(source)`

Items for the home and guest feeds.

```ts
ctx.registerHomeFeedSource({
  id:    "forum",
  label: "Forum threads",
  async recent(limit) { return [...]; },
  async hot(limit)    { return [...]; },   // optional — powers the "Hot threads" rail
});
```

### `registerStatSource(source)`

Counters for the footer stats row.

```ts
ctx.registerStatSource({
  id: "forum",
  async collect() {
    return [{ id: "forum.threads", label: "Threads", value: 128 }];
  },
});
```

⚠ `id` is a machine key the client localises; `label` is the English fallback, not the
display string. See `docs/plugin-i18n.md`.

---

## Earning things

### `registerBadgeCriteria(metric)`

Something a **badge** can be earned for. The forum contributing `forum.posts` is why an
admin can only require forum posts while the forum is installed.

```ts
ctx.registerBadgeCriteria({
  key:   "forum.posts",             // namespace with your plugin's own prefix
  label: "Forum posts",             // a translation key AND the fallback text
  async valueFor(userId) { return 42; },
});
```

⚠ **You report a NUMBER; core does the comparing.** The threshold lives on the badge,
set by an admin, so a plugin never stores or interprets one.

⚠ Different from `registerProgressionCriteria`, which answers yes/no against a ladder
*group's* own thresholds. A badge keeps its thresholds on the badge.

⚠ A badge whose criteria name only metrics from absent plugins is granted to **nobody**,
never to everybody. Two ways to over-grant were closed deliberately; do not "helpfully"
return 0 for an unknown user — throw or return a real count.

### `registerProgressionCriteria(criteria)`

Per-group thresholds for the progression ladder (§38). The plugin owns both the
thresholds and the user's metrics; core never sees your schema.

`evaluate(userId, groupId)` returns one boolean per threshold you have set for that
group — empty if none — and core combines them with its own per
`progression.threshold_logic`.

Its ACP surface is a `groupConfigPanel` tab and it **autosaves**; see
`docs/plugin-acp-autosave.md`.

---

## UI

### `registerAcpPage(page)` / `registerNavItem(item)`

An admin page, and a link in the site nav.

⚠ Plugin nav links always append below core's. The declared `position` is a hint, not
an index — admins reorder in the ACP.

### Blocks, layout templates and slots

Covered in **`docs/plugin-blocks.md`**: `blockRegistry` for first-class blocks,
`ctx.registerLayoutTemplate` for opening one of your own pages to the layout editor, and
the `slotRegistry` contributions (header widget, layout widget, profile tab) that core
mirrors into placeable blocks for you.

### Icons

⚠ **Import `FontAwesomeIcon` from the externalised module** — every plugin already does,
via `__XENTIUM_HOST__.FaReact`. Core swaps that one export for its own wrapper, so your
icons follow the site's icon style with no change and no rebuild on your side.

A plugin that *bundles* its own copy of `@fortawesome/react-fontawesome` silently opts
out: its icons stay solid while the rest of the site changes. Keep it in your vite
externals. See `docs/icon-kits.md`.

---

## Errors and notifications

### `registerNecCodes(codes)`

Your error codes, so the ACP's error reference can explain them.

```ts
ctx.registerNecCodes([{
  code: "NEC-FORUM-6001", msg: "Thread locked", sev: "Warning",
  domain: "Forum", desc: "…", cause: "…", fix: "…",
}]);
```

⚠ Namespace the domain with your plugin. `NEC-API-*` and the other core domains are
core's.

### `ctx.notify(opts)`

```ts
await ctx.notify({
  userId: "…", type: "forum.reply", title: "…", body: "…",
  link: "/forum/thread/1", channels: ["in_app"],
});
```

⚠ **`type` is dotted and prefixed with your plugin's own namespace.** Per-user
preferences are matched by *pattern prefix* (`forum.*`), so an unnamespaced type is
uncontrollable by the member and may collide with core's.

⚠ **Notifications with no human sender must say so.** The bell renders a `UserAvatar`
built from the notification's own `title` unless the type matches a *system prefix* —
which produces initials cut out of a sentence. Declare yours with
`systemNotificationPrefixes` in your plugin meta.

⚠ Notifying must never block the thing it reports. Dispatch **after** your write, and
wrap it: a mail outage must not cost a member the action that succeeded.

### `registerNotificationTypes(types)`

Currently a no-op that only logs — reserved for a future preferences UI. Registering is
harmless and future-proof, but do not rely on it to make a type user-controllable
today; the pattern prefix above is what does that.

---

## Auth and security

### `registerAuthGuard(guard)`

Refuse a login or a registration by throwing.

```ts
ctx.registerAuthGuard({
  id: "beta-invite",
  async beforeRegister(req) { … },   // throw to refuse
});
```

⚠ `beforeRegister` returning `"allow"` **authorises** the registration and core's own
`auth.registration_mode` gate no longer applies — that is how a private beta works on a
site whose registration is otherwise closed. Returning nothing means "no opinion" and
core's policy still runs.

⚠ Staff are passed to `beforeLogin` too. The guard decides whether to exempt them; core
does not assume a policy exempts anyone.

### `registerSecurityScan(fn)` / `claimSecurityPatterns(patterns)`

See **`docs/security-detection.md`**. A plugin claims a core baseline pattern to
*replace* it with a better implementation, rather than both firing.

---

## What core gives you back

`ctx.host` carries `prisma`, `queues`, `env`, `logger`, `errors` (`XentiumError`, `NEC`),
`middleware` (`requireAuth`, `optionalAuth`, `requirePermission`), `utils`
(`resolveAvatar`, `sanitizeRichText`, `cron`), `progression.getEffectiveGroupId`,
`notificationService` and `security`.

⚠ Use `host.prisma`, never your own client. Plugin tables live outside the Prisma schema
and are migrated by the plugin migration runner (`<pluginid>_` prefix, tracked in
`nodevo_plugin_migrations`) — a second client is a second connection pool.
