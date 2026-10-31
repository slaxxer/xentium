# The plugin platform

This page is for you if you want to build a plugin for Xentium. It covers what core does for
you, so your plugin only has to describe what is special about it: its tables, its pages and
its wording.

You get:

- **Events and filters** to react to what happens on a site, and to refuse or add to it.
- **Resources**: describe a table, and core serves its list, read, create, update and delete
  endpoints.
- **Settings** declared as a schema. Core stores them and draws their page in the ACP.
- **Background jobs** that run once, on time, and survive restarts.
- **Files and images**, checked and cleaned, with sizes made for you.
- **People and time**: members named the way core names them, birthdays as members allow,
  and the site's time zone.
- **Notifications members control**, **rate limits** and a **cache**.
- **The browser side**: pages, slots, a field on the sign-up form, settings on blocks in
  Theme Studio, an upload component and typed host members.

Everything here is part of the 1.x promise in [versioning](./versioning.md): we only add to
it in minor releases. Nothing is renamed or removed before 2.0.

Related guides: [blocks](./plugin-blocks.md), [edge art](./plugin-edge-art.md),
[embeds](./plugin-embeds.md), [translations](./plugin-i18n.md),
[ACP pages and the save bar](./plugin-acp-pages.md), [registries](./plugin-registries.md).

## Start a plugin

From a checkout of the Xentium repository:

```sh
pnpm plugin:new my-gallery --name "My Gallery" --vendor "Your name"
pnpm install
pnpm --filter @local/my-gallery build
pnpm plugin:package plugins/local/my-gallery
```

Then upload the `.xtplugin` file in ACP → Extensions → Installed and enable it. The new
plugin lives in `plugins/local/my-gallery`, which git ignores: your plugin is its own project.

What you get is a small working plugin, and a good map of this page:

| File | What it shows |
|---|---|
| `manifest.json` | id, version, `minXentiumVersion: "1.0.0"`, `tablePrefix`, permissions, migrations |
| `migrations/001_*.up.sql` | its table, with the columns resources expect |
| `server/index.ts` | permissions, settings, a resource, a route, a job, an event listener |
| `web/index.tsx`, `web/ItemsPage.tsx` | a public page that lists and creates items |
| `web/locales/en/*.json` | its strings, including the settings page's labels |
| `vite.config.ts`, `tsup.config.ts` | the builds: the browser bundle uses the page's own React |

A plugin has two halves. The **server** half exports a definition with `onEnable` (and
optionally `onDisable`); everything you register there is dropped again when an admin
disables the plugin, and comes back when they enable it. The **web** half is a script the
site loads on every page; it registers routes, slots and blocks.

```ts
import type { PluginDefinition } from "@xentium/plugin-sdk";

const plugin: PluginDefinition = {
  id: "my-gallery",            // the manifest's id
  async onEnable(ctx) {
    const { host } = ctx;      // core's services for this plugin
    // register things here
  },
};
export default plugin;
```

Your plugin's tables must start with the `tablePrefix` from your manifest (for example
`mg_`). Migrations that create anything else are refused at install.

## Events

Core announces what happens on a site. Listen with `ctx.on`:

```ts
ctx.on("user.registered", async ({ userId, method }) => {
  await host.jobs.run("welcome", { userId });
});

ctx.on("article.published", ({ articleId, authorId }) => { /* … */ });
```

Events are sent after the change is saved, and your listener runs after the request has
moved on. It cannot slow the request down, fail it, or see a change that was rolled back. If
a listener throws, we log it with your plugin's name and the other listeners still run. A
listener has 5 seconds; for anything longer, start a job.

Payloads carry ids and the few facts you need to decide. Fetch the rest yourself, and check
who may see it.

| Event | Payload |
|---|---|
| `user.registered` | `userId`, `method` (`password`, `oauth`, `admin`), `addons` (your sign-up field values, see below) |
| `user.loggedIn` | `userId`, `method` |
| `user.updated` | `userId`, `fields` (which ones changed: `bio`, `avatar`, `username`, `privacy`, …) |
| `user.emailChanged` | `userId` |
| `user.groupsChanged` | `userId`, `added`, `removed` (group ids) |
| `user.warned` | `userId`, `warningId`, `byUserId` |
| `user.banned` | `userId`, `until` (ISO time, or null for permanent), `byUserId` |
| `user.unbanned` | `userId` |
| `article.created`, `.published`, `.updated`, `.deleted` | `articleId`, `authorId` |
| `comment.created`, `.deleted` | `commentId`, `articleId`, `authorId` |
| `content.reported` | `reportId`, `targetType`, `targetId`, `reporterId` |
| `setting.changed` | `key` |
| `plugin.enabled`, `plugin.disabled` | `pluginId` |
| `theme.switched` | `themeKey` (`""` is the built-in Core theme) |

Your plugin can announce its own events for other plugins. The name must start with your
plugin's id:

```ts
ctx.emit("my-gallery.photo.uploaded", { photoId, userId });
// another plugin:
ctx.on("my-gallery.photo.uploaded", (p) => { /* … */ });
```

## Filters

At a few points, core asks plugins before it acts. Register with `ctx.filter`.

A **validate** filter can stop the action. Return a refusal with a translation key from your
own namespace, or nothing to let it through. The first refusal wins, and the member sees your
message.

```ts
ctx.filter("registration.validate", ({ username }) =>
  username.toLowerCase().includes("admin")
    ? { refuse: "mygallery:errors.reservedName", params: { name: username } }
    : undefined);
```

| Filter | When | Input |
|---|---|---|
| `registration.validate` | before any account is created | `email`, `username`, `method`, `addons` |
| `article.validate` | before an article is saved or published | `userId`, `articleId` (null when new), `title`, `body` (plain text), `publish` |
| `comment.validate` | before a comment is saved | `userId`, `articleId`, `body` (plain text) |
| `notification.validate` | before a notification is delivered | `userId`, `type`, `title`, `body`. A refusal drops it silently |

A refusal answers the request with `422` and the code `XEC-PLUGIN-4220`; the details carry
your key, so the site shows your own words.

A **contribute** filter adds to a response. `profile.extra` gets the member being viewed and
who is looking; what you return appears in the profile response under
`extra["<your plugin id>"]`. You can add to a response, but you cannot change what core or
another plugin put there.

```ts
ctx.filter("profile.extra", async ({ userId, viewerId }) => ({ photos: await countPhotos(userId) }));
```

A filter has 2 seconds. One that throws or runs out of time counts as "no change", so a broken
plugin can never lock members out of signing up.

## Resources

Describe a table, and core serves it at `/api/p/<your id>/<name>`:

```ts
await ctx.registerResource({
  name: "photos",
  table: "mg_photos",
  schema: z.object({
    title: z.string().trim().min(1).max(120),
    albumId: z.string().uuid(),
    takenAt: z.coerce.date().nullable().default(null),
  }),
  owner: "author_id",
  softDelete: true,
  access: { read: "public", create: "mygallery.upload", update: "own", delete: "own", manage: "mygallery.manage" },
  sort: ["title", "takenAt"],
  filter: ["albumId"],
  search: ["title"],
});
```

| Request | Does |
|---|---|
| `GET /photos?page=1&limit=20&sort=-takenAt&albumId=…&q=sunset` | lists, newest first by default: `{ data, meta }` |
| `GET /photos/:id` | one photo |
| `POST /photos` | creates one; the owner is the member who sends it |
| `PATCH /photos/:id` | changes the fields you send, and only those |
| `DELETE /photos/:id` | deletes it (with `softDelete`, it can be restored) |
| `POST /photos/:id/restore` | restores a deleted one (managers) |
| `GET /photos?deleted=1` | includes deleted ones (managers) |

Who may do what:

- `"public"`: anyone, guests too. Only for `read`.
- `"members"`: any signed-in member.
- `"own"`: the row's owner. Needs `owner`.
- any other string: members holding that permission key (declare it with `registerPermissions`).
- `manage`: a permission that may do everything to every row, see deleted rows and restore them.

Creating, changing and deleting always need a signed-in member. A row a viewer may not read
answers 404, as if it did not exist.

**Your table** needs an `id` column (text or uuid, core fills it), one column per schema field
(`takenAt` becomes `taken_at` unless you set `columns: { takenAt: "shot_at" }`), the `owner`
column, `created_at` and optionally `updated_at` (core keeps both; turn this off with
`timestamps: false`), and `deleted_at` with `softDelete`. Core checks the table and every
column when your plugin is enabled, and refuses to enable it when something is missing, with
a message that names it.

Every request is checked against your schema; unknown fields are refused, not dropped. Values
always reach the database as parameters, never as SQL.

**Your own logic** goes in hooks. A `before*` hook may refuse (throw a `XentiumError`) or
return changed data, which is checked again:

```ts
hooks: {
  beforeCreate: async (data, { userId, can }) => {
    if (!(await albumIsOpen(data.albumId))) throw new host.errors.XentiumError({ code: "XEC-API-4003", httpStatus: 403, message: "This album is closed" });
  },
  afterDelete: async (row) => { await host.files.removeFor({ kind: "photo", itemId: row.id as string }); },
},
```

Each change is announced as an event: `<your id>.<name>.created`, `.updated`, `.deleted` and
`.restored`, with `{ id, userId }`. Listen to those if you want an audit trail.

Your own routes (`ctx.registerRoutes`) answer first, so you can replace any of these
endpoints for something special and leave the rest to core.

## Your own database client

A small plugin is fine with resources and a few SQL queries through `host.prisma`. A
plugin the size of an application (a shop, a file base) is easier to get right with a
typed client of its own: Prisma, Drizzle, Kysely or plain `pg`. Run it on `host.pg`,
the site's own connection pool (a node-postgres `Pool`), so your plugin shares core's
connections instead of opening more:

```ts
import type { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";   // generated from YOUR schema

export function storeDb(host: PluginHost) {
  return new PrismaClient({ adapter: new PrismaPg(host.pg as Pool) });
}
```

Three rules:

- **Your SQL migrations still create the tables.** The client's schema only describes
  them, with every model mapped to your prefixed table (`@@map("mg_photos")`). Never run
  the client's own migration commands against a site.
- **Keep the two in step.** Change a migration, change the schema in the same commit.
- **Don't close the pool.** It belongs to the site. `host.pg` is missing on a core older
  than 1.0.0, so check for it if you support one.

Verifying a webhook or a signed request? `req.rawBody` holds the exact JSON body bytes
as they arrived. Hash those, never `JSON.stringify(req.body)`: re-serialising gives
different bytes and the signature never matches.

## Sensitive changes

Some changes must not be made by a stolen session alone: where a member's money goes,
the address their mail goes to. Ask again:

- `host.middleware.requireStepUp` on the route: a member with two-factor sign-in on is
  asked for a fresh code (the browser prompts and repeats the request). Mount it after
  `requireAuth` and before any upload parser.
- `host.auth.verifyPassword(userId, password)` in the handler, for their current
  password. `host.auth.hasPassword(userId)` says whether they have one at all (a member
  who only signs in through Google or GitHub doesn't).

## Settings

Declare your settings as a schema. Core stores them, fills in defaults, checks every save and
draws their page in the ACP, under Extensions unless you name another section:

```ts
const settings = ctx.registerSettings({
  title: "My Gallery",
  schema: z.object({
    perPage: z.number().int().min(6).max(96).default(24)
      .meta({ title: "mygallery:settings.perPage", description: "mygallery:settings.perPageHint", public: true }),
    layout: z.enum(["grid", "masonry", "list"]).default("grid")
      .meta({ title: "mygallery:settings.layout", section: "mygallery:settings.display", options: { masonry: "mygallery:settings.masonry" } }),
    frame: z.string().default("#0d7c72").meta({ widget: "color" }),
    intro: z.string().max(2000).default("").meta({ widget: "textarea" }),
    comments: z.boolean().default(true),
  }),
});

const { perPage } = await settings.get();   // typed from the schema
```

Use `host.zod` (the site's own Zod 4) so you need not bundle one.

| In the schema | On the page |
|---|---|
| `z.boolean()` | a switch |
| `z.number()` with `min`/`max` | a number field |
| `z.enum([...])` | a choice; `options` names each value |
| `z.string()` | a text field; `widget: "color"` or `"textarea"` for those |

Per field, `.meta()` takes `title`, `description` and `section` (fields with the same section
share a card). Each may be plain text or a translation key in your namespace. `public: true`
lets your own pages read that setting (see the browser section); everything else only admins
see.

Every field needs a `.default(…)` or `.optional()`. When you change a field in an update and
a stored value no longer fits, that field falls back to its default and the others keep
theirs. A save that does not fit is refused with a message per field, shown next to the field.
`host.settings.get()` and `.set()` read and write the same values from anywhere in your plugin.

## Background jobs

Work that should run once, later or on a schedule, belongs in a job. Never use `setInterval`:
your plugin is loaded in every API process and in the worker, so a timer runs once per
process, and anything waiting on it is lost when the site restarts.

```ts
ctx.registerJob({
  name: "reminder",
  handler: async ({ eventId }, { attempt }) => { /* … */ },
  retries: 3,                       // default 3, with a growing pause
});

await host.jobs.run("reminder", { eventId });                          // now, in the background
await host.jobs.at("reminder", { eventId }, startsAt, { key: `ev-${eventId}` });
await host.jobs.at("reminder", { eventId }, newTime, { key: `ev-${eventId}` }); // same key: moved
await host.jobs.cancel("reminder", `ev-${eventId}`);
await host.jobs.every("cleanup", { cron: "15 3 * * *" });              // in the site's time zone
await host.jobs.every("sync", { everyMinutes: 15 });
```

Jobs run in the site's worker, exactly once, and survive restarts. Call `every` in `onEnable`;
calling it again replaces the schedule. Admins see your repeating jobs, read only, in
ACP → System → Scheduled Tasks.

While your plugin is disabled, its repeating jobs stop and its other jobs wait; they run again
once it is enabled. Uninstalling removes them. A job whose handler keeps failing is logged in
ACP → System → Error Log.

## Files and images

```ts
const file = await host.files.save(req.file, {
  visibility: "public",              // or "private"
  accept: ["image"],                 // image, pdf, archive, audio, video, document, or types like "png"
  maxBytes: 20 * 1024 * 1024,        // default 20 MB, at most 200 MB
  kind: "photo", itemId: photoId,    // yours: for list and removeFor
  uploaderId: req.userId,
});
// file.ref (store it), file.url, file.variants.thumb.url, file.width, …
```

Core checks the type from the file's contents, never its name, and names the file itself; the
member's file name is kept only as `originalName`. Every image is turned upright and saved
again **without its camera data and GPS position** (a phone photo carries where it was taken),
and comes in three sizes: `thumb` (320 px), `medium` (1280 px) and `full` (2560 px), never
larger than the original.

A **public** file has a URL anyone can open. A **private** file has none; it leaves only
through your own route, after your own check:

```ts
router.get("/invoices/:id", host.middleware.requireAuth, async (req, res) => {
  const invoice = await findInvoice(req.params.id);
  if (invoice.userId !== req.userId) return res.status(404).end();
  await host.files.send(res, invoice.fileRef, { download: "invoice.pdf" });
});
```

Anything that is not an image always downloads instead of opening in the browser.
`host.files.get`, `.list({ kind, itemId })`, `.remove(ref)` and `.removeFor({ kind, itemId })`
find and remove your files; you only ever see your own. Remove a file when its item goes.
Uninstalling your plugin with its data removes all of its files.

## People and time

```ts
const refs = await host.users.refs([authorId, otherId]);
// refs[authorId]: { username, displayName, avatarUrl, badgeColor, profileUrl, active }

const today = await host.users.birthdays(start, end, viewerId);
// [{ userId, month, day }]: never a year

if (await host.users.canSee(viewerId, ownerId, "posts")) { /* … */ }

const zone = await host.time.zone();          // "Europe/Berlin", or UTC
const midnight = await host.time.startOfDay();
const key = await host.time.dayKey(new Date());   // "2026-10-24"
```

`refs` names members exactly as core does, so names keep their group colour everywhere.
`birthdays` only lists members who chose to show their birthday in Account → Privacy, as the
date field's visibility allows the viewer (guests see fewer), and never someone who blocked the
viewer or whom the viewer blocked. It is the only way your plugin should learn a birthday.
`canSee` gives the same answer the profile page acts on.

### Groups

```ts
const customers = await host.groups.ensure({ key: "customer", name: "Customer", badgeColor: "#c8a24a", nameGlow: true });
await host.groups.add(userId, customers);
await host.groups.remove(userId, customers);
```

`ensure` creates a group your plugin needs the first time, with the name and badge you
give it, and returns its id after that. Pass `permissions: ["my-plugin.publish"]` and the
new group holds them; that happens once, when it is created, so an admin who takes one away
later is never overruled. A group can't be made holding `admin.access`. From then on the group is the
admin's: they rename or recolour it in ACP → Groups and `ensure` never overwrites it. Its
badge and name colour show wherever core draws group badges. `add` refuses any group that
holds `admin.access`: a plugin never makes someone an administrator.

`host.time` works in the site's time zone from ACP → System Settings. When the site shows
each visitor their own zone, there is no site zone on the server and these use UTC.

## Notifications

Send a notification with `ctx.notify({ userId, type, title, body, link, channels })`, and
declare each type you send, so members can switch it off in Account → Notifications:

```ts
ctx.registerNotificationTypes([
  { type: "gallery.comment", label: "mygallery:notify.comment", description: "mygallery:notify.commentHint" },
  { type: "gallery.review", label: "mygallery:notify.review", email: false, permission: "mygallery.moderate" },
]);
```

Each type gets an in-app switch, and an email switch unless you set `email: false` (email is
off until the member turns it on). A type with a `permission` only shows to members who hold
it, for notifications only staff receive. A type you never declare cannot be switched off, so
declare every one. Types may not start with core's own prefixes (`social.`, `profile.`,
`mention.`, `article.`, `progression.`, `badge.`, `system.`, `license.`, `mod.`).

## Rate limits and cache

Anything members can post needs a limit. `host.limits` counts on the site's Redis, so a limit
holds across every process:

```ts
const perMember = host.limits.middleware("comment", { windowSec: 60, max: 10 });   // after requireAuth
router.post("/comments", host.middleware.requireAuth, perMember, createComment);

const { ok, retryAfterSec } = await host.limits.check("vote", userId, { windowSec: 3600, max: 50 });
```

Over a limit, a route answers `429` with a Retry-After header. Create middleware once in
`onEnable`, not per request; `by: "ip"` counts per address, for routes guests can use.

`host.cache` keeps small values for a while, as JSON:

```ts
const top = await host.cache.remember("top-photos", 300, () => loadTopPhotos());
await host.cache.del("top-photos");
```

Keys belong to your plugin alone; no other plugin can read or clear them. Uninstalling your
plugin with its data removes them.

## The browser side

Your web bundle reaches core through `window.__XENTIUM_HOST__`. Types for it are in
`@xentium/plugin-sdk/web`:

```ts
import { xentiumHost } from "@xentium/plugin-sdk/web";
const host = xentiumHost();
```

In your build, the shared modules (React, the router, the query client, i18n and core's own
`@web/*` modules) must be the page's copies, never bundled; the generator's `vite.config.ts`
maps them. Two copies of React on one page break hooks.

**Pages and slots.** `slotRegistry.registerRoute` adds a public or ACP page; other slots put
your UI into core's: profile tabs, Account and Privacy sections, ACP settings sections, the
header next to the notification bell, the member menu, and site-wide overlays. Call
`registerPluginMeta({ pluginId })` first, so everything you register is removed when the
plugin is disabled.

**Only on some profiles.** A profile tab or stat can say whether it belongs on a profile:
give it `shownFor: (userId) => Promise<boolean>` and it appears only where that answers
true (a publisher's listings, say, and not on everyone else's profile). Without it, every
profile has it. Account tabs and member menu items take the same `shownFor`, asked about the
signed-in member: an "Invoices" tab only for someone who has invoices. An entry is hidden
until it answers, and an account tab opened by its link waits for the answer.

**A count in the ACP menu.** `registerAcpBadge({ id, path, count })` puts a number beside
one of your ACP pages (the `path` you gave `registerAcpPage`) while `count()` answers more
than zero, in the side menu and the top menu alike, a dot on your section, and the same dot
on the gear in the site's header, so an admin browsing the site sees it too. The rules and
an example are in [plugin-registries.md](plugin-registries.md#telling-admins-something-is-waiting-slotregistryregisteracpbadge). It is asked every minute while an
admin has the site or the ACP open, so keep it cheap, and answer 0 for an admin it doesn't
concern.

**Your field on the sign-up form.** `registerRegistrationField` puts a field of yours on the
sign-up form. Its value travels as `addons["<your id>"]` to your `registration.validate`
filter (to refuse) and your `user.registered` listener (to store). Core keeps none of it.

```tsx
slotRegistry.registerRegistrationField({
  id: "my-gallery.terms",
  component: ({ value, onChange }) => (
    <label className="dw-field">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {t("signup.photoRules")}
    </label>
  ),
});
```

**Uploads.** The upload component sends files to your own route, with drag and drop, a
progress bar per file, previews, and the server's own message when it refuses one:

```tsx
import { Uploader } from "@web/components/Uploader";

<Uploader url="/p/my-gallery/photos/upload" accept={["image"]} maxBytes={20 * 1024 * 1024}
          multiple extra={{ albumId }} onUploaded={() => refetch()} />
```

**Settings on a block in Theme Studio.** A block panel puts your settings on the block
types you name, and only there: an avatar effect on the avatar block, not on every block.
What it sets is part of the theme's style and reaches every page once the admin publishes.
See [blocks: settings on someone else's block](./plugin-blocks.md#settings-on-someone-elses-block).

**Your public settings.** `usePublicPluginSettings("my-gallery")` from
`@web/plugins/pluginSettings` gives your page the settings you marked `public: true`.

**Events.** `host.events.on("route.changed" | "auth.changed", fn)` follows the page and the
signed-in member, and returns a function that stops listening.

Calls to your API go through `api` from `@web/lib/api`, with the member's session; toasts,
dialogs, names, avatars and the ACP's own controls come from the host too, so your plugin looks
and behaves like core.

## Before you release

- `minXentiumVersion` is `"1.0.0"` in your manifest.
- Your tables start with your `tablePrefix`, and each migration has a `.down.sql`.
- Strings come from your translation files, in your namespace.
- No `setInterval`: background work is a job.
- You never store a birthday, a GPS position or a file's original name as anything but data
  the member gave you on purpose.
- `pnpm --filter <your package> typecheck`, `test` and `build` pass, and the plugin installs,
  enables, disables and uninstalls cleanly on a test site.

## Coming in 1.1

Comments, reactions, "watch this", tags and view counts as shared services for any item of
yours, each with a ready-made component (`<Comments kind id />` and so on), moderation, search
and notifications included. Until then, keep these in your own tables; moving onto the shared
ones later is your choice, and nothing you build now breaks.

When core offers something new to plugins, it appears in a minor release and on this page. If
you need a hook that is not here, tell us: what you are building and where you got stuck.
