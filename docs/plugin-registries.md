# Plugin extension points

Everything a plugin can add to core, in one place. You register all of it from
`onEnable(ctx)`, and it's removed again when the plugin is disabled.

```ts
export default definePlugin({
  async onEnable(ctx) {
    ctx.registerStatSource({ id: "forum", collect: () => … });
  },
});
```

Two rules apply to every registry on this page. They're why a plugin can be disabled
safely.

**Registering isn't storing.** Registries live in memory and are rebuilt on boot. Core
re-enables every enabled plugin before the server starts listening, so the registries are
complete before the first request comes in. Nothing a plugin registers survives a
disable, and nothing should need to.

**Disabling removes what the plugin added, never the admin's data.** Say an admin set a
threshold on a metric your plugin provides, and your plugin gets disabled. We skip that
threshold rather than delete it, and it counts again as soon as your plugin is back. It's
the same rule we use for unknown blocks in a layout: skip it, keep it.

---

## Routes and permissions

### `registerRoutes(router)`

An Express router, mounted at `/api/p/<your-plugin-id>/…`.

```ts
const r = Router();
r.get("/threads", ctx.host.middleware.optionalAuth, handler);
ctx.registerRoutes(r);
```

Core puts an **enabled check** in front of your router. While your plugin is disabled,
every one of its routes answers `404 XEC-PLUGIN-2020` without running your code. So if
anything in core's UI calls a plugin route, it has to cope with that route not being
there.

Use the host's `middleware` (`requireAuth`, `optionalAuth`, `requirePermission`) rather
than parsing tokens yourself. `req.userId` is what the rest of the platform means by "the
caller".

### `registerPermissions(perms)`

```ts
await ctx.registerPermissions([{
  key:      "forum.thread.create",   // domain.action, namespaced to your plugin
  label:    "Create threads",
  domain:   "Forum",                 // how the ACP's permission matrix groups it
  defaults: ["member", "moderator"], // GROUP KEYS, not ids
}]);
```

We upsert by key, so adding a permission in an update is just declaring it. The `label`
is refreshed and existing grants stay as they are.

Heads up: `defaults` are **applied again on every boot**, not only on first install.
`onEnable` runs for every enabled plugin at startup, and the grant is an upsert. So read
`defaults` as "this group always has this", and leave out anything an admin should be
able to take away. (That's a known bug; it's meant to happen on first install only.)

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

Core checks `permission` before it calls `search`, but row-level access is still your
job. Core can't know which of your rows this viewer is allowed to see.

### `registerHomeFeedSource(source)`

Items for the home feed and the guest feed.

```ts
ctx.registerHomeFeedSource({
  id:    "forum",
  label: "Forum threads",
  async recent(limit) { return [...]; },
  async hot(limit)    { return [...]; },   // optional; feeds the "Hot threads" rail
});
```

### `registerStatSource(source)`

Counters for the stats row in the footer.

```ts
ctx.registerStatSource({
  id: "forum",
  async collect() {
    return [{ id: "forum.threads", label: "Threads", value: 128 }];
  },
});
```

`id` is a machine key that the browser translates. `label` is only the English fallback,
not what's displayed. See [Translating a plugin](plugin-i18n.md).

---

### `registerReportTarget(handler)`

Members report your content through core, with `targetType: "plugin-content"` and
`targetId: "<pluginId>:<kind>:<id>"`. Core can't read your tables, so tell it what a
reported item is. Moderators then see the author, a copy of the text and where it is,
ModCanvas opens the page and marks the item, and Warn, Ban and (if you give `remove`)
Remove become available.

```ts
ctx.registerReportTarget?.({
  kind: "post",                                  // xentium-forum:post:<id>
  describe: async (id) => ({
    authorId: post.author_id,
    snapshot: post.body,                         // tags are stripped for you
    where:    thread.title,
    href:     `/forum/thread/${thread.slug}?page=${page}`,   // site-relative only
  }),
  remove: (id, { actorId, reason }) => softDeletePost(id, actorId, reason),
});
```

Return `null` from `describe` when the item is gone. Put
`data-mod-target="plugin-content:<targetId>"` on the item in your page, so ModCanvas can
scroll to it. Call it with `?.` if your plugin should still load on older cores. It is
removed when the plugin is disabled.

## Earning things

### `registerBadgeCriteria(metric)`

Something a **badge** can be earned for. The forum registers `forum.posts`, which is why
an admin can only require forum posts while the forum is installed.

```ts
ctx.registerBadgeCriteria({
  key:   "forum.posts",             // namespace it with your plugin's prefix
  label: "Forum posts",             // a translation key AND the fallback text
  async valueFor(userId) { return 42; },
});
```

**You report a number, and core does the comparing.** The threshold lives on the badge
and an admin sets it, so your plugin never stores or interprets one.

This is different from `registerProgressionCriteria`, which answers yes/no against a
ladder *group's* own thresholds. A badge keeps its thresholds on the badge.

If a badge's criteria only use metrics from plugins that aren't there, **nobody** gets
it; it never goes to everybody. Please don't return 0 for a user you don't know about to
be helpful. Throw, or return a real count.

### `registerProgressionCriteria(criteria)`

Per-group thresholds for the progression ladder. Your plugin owns both the thresholds and
the users' metrics; core never sees your schema.

`evaluate(userId, groupId)` returns one boolean for each threshold you've set on that
group (an empty list if there are none), and core combines them with its own results
according to `progression.threshold_logic`.

Its ACP page is a `groupConfigPanel` tab, and it **autosaves**. See
[Plugin pages in the ACP](plugin-acp-autosave.md).

---

## UI

### `registerAcpPage(page)` / `registerNavItem(item)`

An admin page, and a link in the site's nav.

Plugin nav links always go below core's. The `position` you declare is a hint, not an
index; admins reorder links in the ACP.

### Blocks, layout templates and slots

These are covered in [Plugin-authored layout blocks](plugin-blocks.md): `blockRegistry`
for real blocks, `ctx.registerLayoutTemplate` to open one of your own pages to the Layout
Editor, and the `slotRegistry` contributions (header widget, layout widget, profile tab)
that core turns into placeable blocks for you.

### Icons

**Import `FontAwesomeIcon` from the externalized module.** Every plugin already does,
through `__XENTIUM_HOST__.FaReact`. Core swaps that one export for its own wrapper, so
your icons follow the site's icon style without any change or rebuild on your side.

If your plugin *bundles* its own copy of `@fortawesome/react-fontawesome`, it quietly
opts out: its icons stay solid while the rest of the site changes. Keep it in your Vite
externals. See [Icons](icon-kits.md).

---

### Moderation queues (`slotRegistry.registerModQueue`)

Anything moderators work through one by one, such as threads waiting for approval,
belongs in the moderation shield in the navbar. Each item is a row next to reports
and security cases. Picking one opens its page, marks it and shows a pill with your
actions.

```ts
slotRegistry.registerModQueue({
  id: "forum-approvals",
  label: "Approvals",
  icon: faHourglassHalf,
  fetchItems: async () => pending.map((t) => ({
    id: t.id, title: t.title, line: `by ${t.author} in ${t.node}`,
    createdAt: t.created_at,
    href: `/forum/thread/${t.slug}`,
    markKey: `xentium-forum:thread:${t.id}`,     // the page's data-mod-target
  })),
  actions: [
    { id: "approve", label: "Approve", tone: "primary", run: async (item) => { /* … */ return "Thread approved"; } },
    { id: "reject", label: "Reject", tone: "danger",
      confirm: { title: "Reject thread", body: "The author is told why.", reasonLabel: "Reason" },
      run: async (item, reason) => { /* … */ } },
  ],
});
```

`fetchItems` is polled while the site is open, and its length is the count on the
shield. Return only what this moderator may act on; a failed fetch counts as empty.
`registerModCanvasSection` (a panel in a dialog) still works, but use a queue for
lists of decisions.

## Errors and notifications

### `registerNecCodes(codes)`

Your error codes, so the ACP's error reference can explain them.

```ts
ctx.registerNecCodes([{
  code: "XEC-FORUM-6001", msg: "Thread locked", sev: "Warning",
  domain: "Forum", desc: "…", cause: "…", fix: "…",
}]);
```

Use your plugin's own domain. `XEC-API-*` and the other core domains are ours.

### `ctx.notify(opts)`

```ts
await ctx.notify({
  userId: "…", type: "forum.reply", title: "…", body: "…",
  link: "/forum/thread/1", channels: ["in_app"],
});
```

**Make `type` dotted and start it with your plugin's namespace.** We match per-user
notification preferences by prefix (`forum.*`), so a type without a namespace can't be
turned off by the member and might collide with one of ours.

**Say so when a notification has no human sender.** Unless the type matches a *system
prefix*, the bell draws a `UserAvatar` from the notification's `title`, and you end up
with initials cut out of a sentence. Declare your prefixes with
`systemNotificationPrefixes` in your plugin meta.

A notification should never block the thing it's about. Send it **after** your write and
wrap it in a try/catch: a mail outage shouldn't cost a member an action that already
worked.

### `registerNotificationTypes(types)`

Right now this only logs. We've reserved it for a future preferences UI. Registering is
harmless and future-proof, but it doesn't make a type controllable by users today; the
prefix above does that.

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

If `beforeRegister` returns `"allow"`, you've **authorized** the registration, and core's
own `auth.registration_mode` check no longer applies. That's how a private beta works on
a site where registration is otherwise closed. Returning nothing means "no opinion", and
core's policy still runs.

Staff go through `beforeLogin` too. Your guard decides whether to let them through; core
doesn't assume any policy exempts anyone.

### `registerSecurityScan(fn)` / `claimSecurityPatterns(patterns)`

`registerSecurityScan` runs your own abuse check on core's security-analysis schedule
(every 30 minutes), and your scan opens review cases with `ctx.host.security.createCase`.
With `claimSecurityPatterns` your plugin *replaces* one of core's built-in patterns with
its own version, so the two don't both fire. Core's version comes back when your plugin is
disabled.

---

## What core gives you

`ctx.host` carries `prisma`, `queues`, `env`, `logger`, `errors` (`XentiumError`, `XEC`),
`middleware` (`requireAuth`, `optionalAuth`, `requirePermission`), `utils`
(`resolveAvatar`, `sanitizeRichText`, `cron`), `progression.getEffectiveGroupId`,
`notificationService` and `security`.

Use `host.prisma`, never a client of your own. Plugin tables live outside the Prisma
schema and the plugin migration runner migrates them (with your `<pluginid>_` prefix,
tracked in `xcf_plugin_migrations`). A second client just means a second connection pool.
