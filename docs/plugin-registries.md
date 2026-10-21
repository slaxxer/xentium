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

To decide something rather than refuse a request, ask
`ctx.host.permissions?.has(userId, "your.permission")`. It gives the same answer
`requirePermission` acts on, implied permissions included. It is optional, because older
hosts don't have it, so check before calling.

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

### `registerPageSource(source)`

Describe your own pages for search engines, link previews and sitemaps. Core asks every
source in turn which page an address is, and the first one that knows answers. Only
describe what a guest can open: return `null` for members-only, hidden or unpublished
content, and leave it out of `list()`.

```ts
ctx.registerPageSource?.({
  id:    "my-plugin.items",
  area:  "items",          // the indexing area the SEO plugin offers a switch for
  label: "Items",
  async describe(path) {
    const m = /^\/items\/([^/]+)$/.exec(path);
    if (!m) return null;
    const item = await findPublicItem(m[1]);
    return item && {
      path, kind: "my-plugin.item", id: item.id, area: "items",
      title: item.title, description: item.summary, image: item.cover,
      publishedAt: item.createdAt, modifiedAt: item.updatedAt,
      breadcrumbs: [{ name: "Home", path: "/" }, { name: "Items", path: "/items" }, { name: item.title, path }],
    };
  },
  async list() {
    return (await allPublicItems()).map((i) => ({
      path: `/items/${i.slug}`, lastmod: i.updatedAt, kind: "my-plugin.item", id: i.id,
    }));
  },
});
```

Give each sitemap entry its `kind` and `id` when it is one item: the SEO plugin then leaves
out a page its editor hid from search engines. When one source lists pages of several
areas, give those entries their own `area` too, so turning an area off removes exactly
its pages.

Without the SEO plugin, core turns the description into the page's title, description,
canonical and preview tags itself. Available on cores from 1.0.0-alpha.19, so call it with
`?.`.

### `registerSeoProvider(provider)`

Become the site's SEO provider: the tags of every page, `/robots.txt` and the sitemaps
(`/sitemap.xml`, `/sitemap-<name>.xml`). There is one provider at a time; the SEO plugin
is it. `host.seo` gives the provider what it needs: `describe(path)`, core's
`defaults(path, info)`, `head(path)` and every page source (`sources()`).

### Editor panels (`slotRegistry.registerEditorPanel`)

A tab beside **Details** in a content editor. The article editor shows one for every panel
registered for `contentKind: "article"`. Your component gets the content's kind and id
(`null` until it has been saved once), a live summary of what is being written (title,
excerpt, plain text, first paragraph, headings, word count, links to the site, images
without alt text, the cover) and `setBadge`, which puts a short label on your tab. Save your
own data through your own endpoint.

```tsx
slotRegistry.registerEditorPanel({
  id: "my-plugin.notes", contentKind: "article", label: "Notes",
  component: ({ contentId, draft, setBadge }) => <NotesPanel id={contentId} draft={draft} onScore={setBadge} />,
});
```

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

Its ACP page is a `groupConfigPanel` tab, and it saves through the **save bar**. See
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

### Pages and header widgets (`slotRegistry.registerRoute`, `registerHeaderWidget`)

A header widget is for signed-in members only. Core hides it from guests wherever it is
drawn (the masthead, its own block, the navbar), so your component doesn't need to check.

A public page is open to everyone unless you say otherwise. If it only makes sense for a
member (an inbox, a settings page), pass `requiresAuth: true`. A guest who opens it is
sent to sign in and brought back afterwards:

```ts
slotRegistry.registerRoute({ path: "/messages", component: MessagesPage, layout: "public", requiresAuth: true });
```

This only decides who can open the page. Your API routes still need `requireAuth`, since
anyone can call them directly.

**A header widget can take an icon and a label.** Core places your widget as its own
block, and that block has an Icon field. Your component receives the admin's choice as
`icon` (an icon token, or undefined for your default), so draw it with the host's
`TokenIcon` when it's set (import `@web/components/TokenIcon` and keep it in your Vite
externals, mapped to `webTokenIcon`). To let an admin choose an icon in your ACP pages, use
the same picker core uses: `IconPicker` from `@web/components/IconPicker` (mapped to
`webIconPicker`) gives you an icon token to store and draw with `TokenIcon`. Give the registration a `label` (a plain string or a getter
that translates) so the editor names the block in words rather than by id.

**If it opens a dropdown, follow two conventions.** Put `aria-expanded` on the button
that opens it, and the `xt-pop` class on the panel. The first lets Theme Studio's
previews open your dropdown when an admin clicks it; the second makes it follow the
"Menus & dropdowns" tokens. Paint the panel with the ordinary tokens (`--c-card`,
`--c-fg`, `--c-fg-muted`, `--c-border`) and use `var(--menu-title-fw)` and
`var(--menu-fw)` for weights rather than numbers. See
[the style system](style-system.md#header-dropdowns-and-the-user-menu).

### The user menu (`slotRegistry.registerUserMenuItem`)

A plugin can add a link to the member's avatar menu. It sits between "Account settings"
and "Sign out". You give a label, a path and an icon, and core draws it like its own
entries, so it closes the menu on click and follows the menu's tokens:

```ts
slotRegistry.registerUserMenuItem({
  id: "my-plugin",
  get label() { return getI18n().t("my-plugin:menu"); },
  to: "/membership",
  icon: faCrown,
  order: 10, // lower sits higher
});
```

The menu only shows to signed-in members. The page it links to still decides who may
open it (`requiresAuth` on the route), and your API still checks every request.

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

**Mark what a moderator did.** A notification about a moderation action (approved,
rejected, locked, removed) draws a red shield instead of a sender, the same as core's
own `moderation.*` types. Declare your prefixes with `moderationNotificationPrefixes` in
your plugin meta, for example `["forum.thread_approved", "forum.thread_locked"]`. Use it
only for actions a moderator took; a reply or a like keeps its sender.

A notification should never block the thing it's about. Send it **after** your write and
wrap it in a try/catch: a mail outage shouldn't cost a member an action that already
worked.

### Email to anyone (`host.email`)

A notification reaches members. For someone without an account (a guest who left an
email address), use `ctx.host.email?.send({ to, title, body, link, buttonLabel, locale })`.
It sends the site's notification email: `title` and `body` are plain text and get escaped,
and `link` becomes the button. The mail is queued, so the call returns at once.
`ctx.host.email?.localeOf(userId)` gives the language a member's emails go out in. It's
available on cores from 1.0.0-alpha.19, so call it with `?.`.

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
