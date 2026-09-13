# Last codebase update — 2026-09-12 (Thread page, Forum index, Following a thread, Pin/lock, Thread composer, Composer, Account settings, Badges, docs)

## Release: nodevo-forum 1.4.3 — the sticky thread bar covered the navbar's menus

`plugins/packaged/nodevo-forum-1.4.3.nvplugin` (112.2 KB, 39 entries). No API, schema
or migration change.

**The bug (reported):** on a thread page the notification and profile menus opened with
their tops sliced off by the sticky thread bar. Measured before fixing: `.pub-nav` and
`.ft-bar` were BOTH `z-index: 100`, and `.ft-bar` came later in the document (DOM index
155 vs 107) — at an equal z-index the later element wins.

⚠ **The navbar's dropdown is `z-index: 200` and that could never have saved it.** The
dropdown lives INSIDE `.pub-nav`, so its 200 only orders it against its siblings; the
whole navbar is one stacking context pinned at 100, and nothing inside can rise above
something that beats that 100. Raising the dropdown would have done nothing — the bar
had to come down.

**Fixed:** `.ft-bar` is `z-index: 90` — above page content (the highest in the body is
60), under the chrome. Verified by probing `elementFromPoint` down the bar's band with
each menu open: every probe now lands inside `.pub-nav`, and the bar still covers the
posts scrolling beneath it. Also checked the mirror case — there is NO stacking context
between a post card and the root, so this page's `z-index: 500` modals still cover both
the navbar and the bar.

---

## Release: nodevo-forum 1.4.2 — a like and a dislike are mutually exclusive

`plugins/packaged/nodevo-forum-1.4.2.nvplugin` (111.8 KB, 39 entries). No API, schema
or migration change.

**The bug (reported):** one member could hold BOTH a like and a dislike on the same
post. `togglePostLike` and `togglePostDislike` were independent toggles that knew
nothing about each other. Reproduced against the running instance before fixing:
`like_count=1 dislike_count=1` from one user.

**Fixed:** voting the other way MOVES the vote. Liking a disliked post drops the
dislike and its counter; disliking a liked post drops the like, its counter, AND the
author's `like_count_received` — the one counter outside this plugin's tables, which
the like path increments. Verified through all six transitions (like → dislike → like
→ off → dislike → off): rows, both counters and the author's total stayed consistent
at every step, and the UI lit only one half throughout.

⚠ **Each branch is one `$transaction`** — the first in this plugin. A moving vote
touches two counters plus a running total, and these are denormalised with nothing to
recompute them, so a half-applied move is a wrong number forever. The notification
dispatch stays OUTSIDE it: a queue failure must not roll back a vote that happened.

**Existing bad rows heal themselves** — either subsequent vote removes the opposite
first. There is no data migration because plugin migrations are DDL-only by design
(`validateMigrationSql` enforces it).

⚠ **A near-miss worth recording:** the scripted replacement of `togglePostLike`
spanned to the next `export`, and `dispatchMentionNotifications` sat between them — it
was silently deleted. Caught by `typecheck` (`Cannot find name`), restored, and then
checked properly by diffing the source's function list against the last PACKAGED
bundle: "functions in the shipped bundle but NOT in the source now: none". Replacing a
range between two symbols needs that diff, not just a green typecheck.

---

## Release: nodevo-forum 1.4.1 — index spacing fix

`plugins/packaged/nodevo-forum-1.4.1.nvplugin` (111.8 KB, 39 entries). Patch only: no
API, schema or migration change.

**The bug (reported):** on the forum index there was no gap between *Recent threads*
and the first category — a 0px seam that read as one tall card with a rule across it.
Measured: every category-to-category gap was 22px and that one was 0.

**Cause:** core's MAIN region deliberately supplies no `gap` — blocks there space
themselves with their own `margin-bottom`, and the RAIL is the one that supplies a gap
(`coreBlocks.scss` says so). Only `.fx-cat` carried a margin, so the card above the
first category had none.

⚠ **Fixed by the REGION, not by the component.** A bottom margin by default, cancelled
inside `.nv-region--aside`. Every one of these blocks is placeable anywhere, so keying
the spacing off the component's own `rail` flag would have left the identical seam one
drag later — verified by moving a rail card into the main region in the DOM and
watching it pick up 22px on its own. `.fx-cat:last-child` still wins on specificity
(0,2,0 vs 0,1,0), so the category list ends flush and its wrapper supplies the gap.

⚠ **Backticks inside a template literal broke the build for the THIRD time** this
session (an SQL comment, then two CSS comments). `indexStyles.ts` now carries the same
NO BACKTICKS banner `threadStyles.ts` already had, and the fix is checked by scanning
the literal for unescaped backticks.

---

## Release: nodevo-forum 1.4.0, packaged

`plugins/packaged/nodevo-forum-1.4.0.nvplugin` (111.2 KB, 39 entries). Manifest +
package.json 1.3.0 → **1.4.0**; changelog `changelog/2026-09-12-v1.4.0.md`, indexed.
No new migration and no schema change.

Archive verified the same way as 1.3.0 — manifest schema, 17 migrations present in
both directions, entrypoints, no zip-slip — plus a content check that the thread-page
CSS and the summary endpoint are actually inside, and that the installed copy is
byte-identical to the archive.

⚠ **The cache-buster mistake from 1.3.0 is not repeated.** Dev iterations used
`1.4.0-rc1 … -rc6` in `installed_version` — a PRERELEASE of the real version, so
`updatePlugin`'s forward-only check still sees 1.4.0 as newer and the non-destructive
update path stays open. The row is back to plain `1.4.0` now. Never write a version
into that column that is ahead of the release.

---

## The thread page, rebuilt (forum plugin)

Source: `nodevo-redesign/Forum thread page redesign/Forum Thread - Redesign.dc.html`
(gitignored). ⚠ NOT `nodevo-redesign/Thread page redesign/`, which is the COMPOSER and
was integrated earlier the same day — two folders, similar names, different pages.

`web/threadStyles.ts` (new, injected like `indexStyles.ts`) + a rewritten
`ForumThreadPage.tsx`: a sticky thread bar, the design's header, a 176px author column
with a head strip and a grouped action bar, a participants + thread-info rail, and a
pagination row that says where you are and carries the page's two actions.

**New endpoint** `GET /threads/:threadId/summary` — who posted and how often, plus the
thread's totals, across the WHOLE thread rather than the page on screen.
⚠ Not `/participants`, which lists who the author INVITED to co-edit the opening post.

**Report a post** goes through core's `POST /moderation/reports` with
`targetType: "plugin-content"`; verified end to end into `ncf_moderation_reports`.

**Four bugs, all found by looking:**
1. **"Original post" (and the accent border) appeared on every post the thread's
   author wrote** — `isOp` meant "by the thread author", not "is the first post", and
   an author almost always replies to their own thread.
2. **Participants were offered Edit on the wrong posts.** `editPost` on the server
   allows a participant to edit "the first post of the thread"; the page offered the
   button on every post by the thread's author, so each failed with 403 on save. Same
   root cause as #1, in the same file.
3. **Quote and Reply were still offered on a CLOSED thread** — the composer could only
   fail with NEC-FORUM-6010, after someone had written their reply. Likes stay.
4. **The like/dislike control collapsed to 2px on a phone**: the action bar wraps, and
   a wrapping row whose items also shrink gets the worst of both. `flex-shrink: 0`.

⚠ **The phone avatar needed `!important` on three levels.** The host's `Avatar` writes
its width and height INLINE on the wrapper and the circle, so no selector specificity
can shrink it for the byline row.

⚠ **This site runs a FontAwesome kit**, so `FontAwesomeIcon` renders `<span><i>` and
not `<svg>` — a DOM check for `svg[data-icon]` reported a missing icon that was
actually there. Assert on classes, not on the element name.

**Absent, and deliberately:** the unread divider ("New since your last visit") and the
bar's "First unread" — nothing in this plugin records what a member has READ, the same
gap that keeps an unread count off the index's subscriptions card. The bar's "Latest"
is the half that is real. The header's "…" more-actions menu has nothing behind it
that is not already a button.

⚠ Verified at phone width by applying the page's OWN `@media (max-width: 720px)` rules
(read back out of `document.styleSheets`) at a 400px container — `resize_window` does
not work in this window manager.

Test data — two throwaway accounts, a seeded thread with five posts, a filed report,
and a temporary moderator grant — all removed, node counters recomputed, and the
forum migration ledger confirmed still at 17 rows with no re-run.

---

## Release: nodevo-forum 1.3.0, packaged

`manifest.json` + `package.json` bumped **1.2.0 → 1.3.0** (a minor bump: four
feature changes, no breaking ones, no new migration — following reuses migration 005,
which had shipped in 1.0.0 with nothing reading it). Changelog entry
`changelog/2026-09-12-v1.3.0.md`, indexed in the plugin's `CHANGELOG.md` — which was
also missing its 1.2.0 line, now added.

Built and packaged with
`node scripts/package-plugin.mjs plugins/official/nodevo-forum plugins/packaged`
→ **`plugins/packaged/nodevo-forum-1.3.0.nvplugin`** (103.4 KB, 39 entries).
⚠ The second argument matters: the script's default outDir is `dist/marketplace`.

Archive verified: `manifest.json` + `package.json` at the root, 34 migration files
(17 up + 17 down, every declared name present in both directions), both declared
entrypoints present, no directory entries, and no absolute or `..` paths. The manifest
passes every rule in `packages/plugin-engine/src/manifest.ts`. The installed dev copy is
byte-identical to what went into the archive.

⚠ **`ncf_installed_plugins.installed_version` is a CACHE-BUSTER, not a version.**
`main.tsx` appends it to `/api/meta/plugin-web/<id>?v=`, so bumping it is how a rebuilt
web bundle reaches the browser — it went 1.4.1 → 1.5.5 during the session for exactly
that reason and none of those numbers existed. The dev row and its `manifest` jsonb are
set back to **1.3.0** so the ACP reports the release it is actually running.

⚠ `plugins/packaged/` is GITIGNORED — the artifact stays local, ready to upload.

---

## The forum index, in six blocks (forum plugin)

Source: `nodevo-redesign/Forum index redesign plan (2)/forum-index-redesign/` (gitignored).
The canvas names its own block ids — `forum.recentThreads`, `forum.categoryList`,
`forum.topUsers`, `forum.recentTags` — so the design is asking for the page to be a
COMPOSITION, not a redrawn slab. It is now six blocks in four regions.

**New blocks** (all placeable on ANY template — each fetches its own data through the
plugin's own permission-checked endpoint and reads no host context):
`forum.indexHead` (eyebrow + title, both overridable as props),
`forum.recentThreads`, `forum.categoryList`, `forum.topUsers`, `forum.subscriptions`,
`forum.recentTags`.

**Four new endpoints**, all `optionalAuth` except the last:
`GET /index/recent-threads`, `/index/top-contributors?metric=threads|posts|likes`,
`/index/tags?days=`, and `/index/subscriptions` (`requireAuth`).

⚠ **Each of the four repeats the same three filters and none is optional.** They reach
across NODES, so unlike every other query in the service they cannot inherit a node's
access check from the route: `visibilityFilter` (a staff-only node's thread title must
not appear in a "Recent threads" card on the public index), `approval_status`, and
`hiddenAuthorIds`. Verified by making a node members-only and watching a guest lose
the thread, the tags that only that thread carried, AND one of the contributor's four
threads — then restoring it.

⚠ **The leaderboard counts the forum's OWN rows**, not `ncf_users.thread_count` /
`post_count` / `like_count_received`. Those are site-wide running totals other
features also write, so a "Top contributors" card built on them would rank people by
activity that never happened in the forum. For `likes` the POST's author is credited,
not the liker.

⚠ **"Recently used tags" is a WINDOW, not a sort** (`days`, default 90). Ranking every
tag ever used by total count shows the same nine forever.

⚠ **No unread badge on the subscriptions card**, unlike the mockup's "3 new". Nothing
in this plugin records what a member has READ — `forum_subscriptions` has `notify_type`
and a `created_at`, that is all — so the card shows last activity instead of inventing
a number. Read tracking is a column plus a write on every thread view, and that is not
this page's job. The card also draws NOTHING for a guest (not an empty state), and the
rail collapses around it.

⚠ **A plugin has no stylesheet.** `main.tsx`'s loader fetches one SCRIPT per plugin —
`web/dist/forum.css` is emitted by the build and never requested by anything. So the
CSS ships as a string in `web/indexStyles.ts` and injects itself, the way
`nodevo-launch` does. Real CSS rather than the forum's older `onMouseEnter` hover
handlers: thirty rows would be sixty handlers where `:hover` is one line. Every value
is a core token, so the Style Editor restyles this page.

⚠ **`forum.indexPage` is NOT removed and still renders.** Every install that stored a
document has that node in it. The change is purely additive: six new block types plus
a new `defaultDocument`. Verified BOTH paths — the composition renders, and deleting
the published row (what a fresh install is) renders the same page from the code default.

⚠ This dev instance's own `forum.index` document was customised (a shoutbox
`pluginSlot` + `forum.indexPage` with icon overrides). It was **backed up, restored
byte-for-byte, and left published**; the redesign is staged as the **DRAFT**, with
their shoutbox carried over verbatim at the top of `main`, so one Publish in the Layout
Editor adopts it and nothing was overwritten.

**Two bugs found only by looking:**
1. The leaderboard's empty state read "Nobody has posted yet." on the **Likes** tab of
   a forum with posts and no likes. One empty state serves three tabs, so it is
   metric-neutral now.
2. The metric labels were one key set doing two jobs — a TAB ("Threads") and a unit
   after a number ("4 threads"). English wants different case; German capitalises both.
   Split into `index.metric.*` and `index.unit.*`.

**Narrow screens:** core already stacks `main` + `aside` below 1024px. Below 720px the
subforum row DROPS its two numeric columns rather than shrinking them (four columns in
340px starves all four, and the name and last-post time are what a row is read for),
and the category head wraps its STATS — forcing the names to 100% put the glyph tile
alone on a line above the title it labels. Below 560px the reply count goes and the
time stays. ⚠ Verified by forcing the rules on at a 400px container: this window
manager refuses `resize_window`, so this was not a true 400px viewport.

⚠ **Backticks inside a template literal, twice in one session** — once in an SQL
comment in `forum.service.ts`, once in a CSS comment in `indexStyles.ts`. Both ended
the literal and produced a parse error pointing at the wrong line.

Released as **nodevo-forum 1.3.0** and packaged (see the release section at the top).

---

## Following a thread (forum plugin)

`forum_subscriptions` has existed since migration 005 with **nothing reading or writing
it**. This is the first writer, plus the two notifications it exists for.

**`PUT /p/nodevo-forum/threads/:threadId/subscription`** — `{ subscribed: boolean }`,
`requireAuth` and nothing more. Following is a member acting on their own
notifications, not on the thread: it grants no read access, so no permission gate
belongs on it. PUT because following twice is following once, and the desired state
rides in the body so the button can be a plain toggle. 404 `NEC-FORUM-6002` for a
thread that is gone, 422 for a missing flag, 401 for a guest — all verified.

**Who hears about what**
- A **reply** → `forum.thread_reply` to every follower.
- An edit to the **first post** → `forum.thread_updated` (newly registered). Editing
  reply #40 is not an update to the thread, and notifies nobody. Both verified,
  including the silence.
- **Never the actor.** A bell for your own reply is the fastest way to teach someone
  to ignore the bell.
- **Never someone the same post just mentioned.** `dispatchMentionNotifications` now
  RETURNS the ids it rang and the fan-out is chained after it, skipping them — one
  reply, one bell. Verified: a reply mentioning a follower produced exactly one
  notification (`forum.mention`), not two.
- Fire-and-forget and **capped at 500**; past the cap a log line says this belongs in
  a job. One member's reply must not take seconds because a thread is popular.
- `channels: ["in_app", "email"]`, so core's per-user `forum.*` preference decides
  whether the mail is sent. That is why the mockup's separate **"Email me on replies"
  pill is deliberately absent** — it would be a second answer to one question.

**`viewer_is_subscribed`** is folded into `GET /threads/:slug` beside
`viewer_is_participant`, not given its own request: the Follow button has to be right
on first paint, or it renders "Follow" for a moment to someone already following.

**Creating a thread** accepts `follow: true` — the mockup's "Follow thread" pill. It
rides ALONG with the create (unlike pin/lock, which need a privilege and so take a
second request): following needs no permission, and a second call could fail and leave
an author unsubscribed from their own thread. **Nobody is auto-subscribed**; the pill
is how they say yes.

**UI**
- Thread page: a Follow / Following pill in the thread's own meta (a member action, so
  not in the moderator row), optimistic, reverting on failure.
- New-thread page: the Options row now renders for **everyone** with Follow thread;
  pin and lock stay moderator-only inside it.
- One icon for both states, like Pin — only `free-solid` is installed, and the filled
  pill already says which state it is in.

⚠ **Found while verifying:** the bell drew initials taken from the notification TITLE
("NR" for *New reply in…*) because no forum notification passes `senderUserId`, which
is what `dispatch` uses to attach the real avatar. The two new dispatches pass it (now
showing the actor); the other nine forum call sites still do not — logged in BUGS.md
rather than rewritten in this pass.

Shipped as forum bundle **1.4.2** (server + web rebuilt and installed).

---

## Pin / lock (forum plugin)

`PATCH /p/nodevo-forum/threads/:threadId/moderation` — `{ pinned?, closed? }`, gated
on **`forum.moderate`**. The columns existed with no writer; this is the writer.

- **"Locked" is stored as `status = 'closed'`** — not a choice: that is the value
  `createPost` already refuses on, so a lock written under any other name would draw a
  padlock and still accept every reply. Verified: a reply to a closed thread returns
  422 `NEC-FORUM-6010`.
- Only the fields PRESENT are written — pinning must not silently reopen a closed
  thread, which a fixed two-column UPDATE would do.
- The author is told when their thread is **closed** (`forum.thread_locked`, already
  registered with core's preference matcher), only on the transition, and never when
  the moderator is the author. Both branches verified.
- **Thread page:** Pinned / Closed badges and moderator Pin / Close buttons, optimistic
  on the cache the badges read from, refetching on failure.
- **New-thread page:** the redesign's two Options pills, moderators only. They apply
  in a SECOND request after creation — creating is something any member may do, and
  the create endpoint must not become the place a privilege is decided. If that call
  is refused the thread still exists, and the toast says which half did not happen.

⚠ **A hole next door, closed:** `POST /threads/:id/approve` and `/reject` were gated by
`requireAuth` ALONE and neither service re-checks — so any signed-in member could
approve or reject any pending thread. Both now require `forum.moderate`. Verified by
revoking the permission from the admin group and confirming 403 `NEC-PERM-1001` on all
three routes, then restoring it.

Shipped in **nodevo-forum 1.3.0** (the 1.4.1 in this session's logs was the dev cache-buster, not a release).

---

## The thread composer (forum plugin)

From `nodevo-redesign/Thread page redesign`. The new-thread page was a stack of
labelled boxes — "TITLE", then "TAGS", then an editor card, then a footer — with a
`<label>` shouting over every field. It is ONE CONTINUOUS SURFACE now: a byline saying
who is posting and where it lands, the title as the big text it will become (with its
counter and a rule that lights up), tags inline under it, the editor below, and the
footer. Nothing announces what the shape already says.

- **The category is a control, not breadcrumb text.** A picker in the byline lists
  every subforum that accepts threads; arriving from the wrong one used to mean going
  back and starting again.
- **`toolbarPosition="top"`** — new on core's `Composer`, for this surface only. The
  body is 360px on a page of its own, so a bottom bar would sit a screen away from the
  title; the bottom row becomes a **status strip** instead (@ to mention, Ctrl↵ to
  post, drop files anywhere, words · characters). Every other surface keeps the
  docked bar.
- The **edit page** gets the same composer and the redesign's amber **reason band** —
  which is real: the reason already travels with `PATCH /posts/:id`.
- `Composer` is exposed as a host global (`webComposer`), so a plugin page can pick a
  variant instead of going through the `ForumEditor` adapter.

### Three bugs found by looking

1. **The category picker was empty** — the page read `/nodes`, which returns ROOT
   nodes only; on a normal forum those are all categories, so three subforums sat one
   level down, invisible. It reads `/nodes/all` now.
2. **`/forum/:slug/new` let you write into a category that accepts no threads**, then
   failed the submit with NEC-FORUM-6010 after the work was done. The page says so
   first, and offers the subforums as the way out.
3. **Chrome would not commit a transition from `rgba(...)` to a `color-mix()`** of a
   custom property: the title's rule never lit up even though its inline style said
   it should. Two plain token values instead.

Also fixed in core: with the tools on top the character count appeared **twice** (bar
and strip), and Write/Preview floated over the body's corner under the row it now
belongs to.

**Absent, deliberately:** the design's Options pills (follow / email me on replies /
pin / lock) and Save draft. The forum API has no endpoint for any of them —
`is_pinned` and `status` are columns nothing can write yet — and the mockup's
"View 3 revisions" link has nothing to list. The edit page's title and tags keep their
labelled form for now; only the new-thread page got the borderless treatment.

⚠ The forum plugin's source is gitignored, so this lands as a rebuilt bundle:
`web/dist` was rebuilt and copied to `apps/api/var/uploads/plugins/nodevo-forum/web/dist/`
with `installed_version` bumped to **1.3.4** as the cache-buster. Verified live —
posted a real thread through the redesigned page and deleted it afterwards.

---

# Composer + Account settings + Badges + docs (earlier the same day)

## The Composer — one editor for every surface

From `nodevo-redesign/Wyswing editor redesign`. `MiniEditor` (article comments,
profile wall, private messages) and `ForumEditor` (threads, replies, quick edit) were
two components that had drifted into two toolbars, two placeholder mechanisms, two
sets of glyph characters (`⫧ ≡ ❝ x₂`) and mentions on exactly one of them. Both now
render `<Composer>`.

**The signature move: the toolbar is at the BOTTOM**, docked to the action bar beside
the button it serves — writing starts where the cursor is, chrome sits where the hands
are, and at phone width the bar is already above the keyboard.

Three variants, one component: `inline` (collapsed to a 58px row until needed —
verified at exactly 58px), `panel` (always open, for a page whose job is writing),
`dock` (one row, formatting behind `Aa`, Enter sends).

- **Block picker** — one control for Text / H1 / H2 / H3 / Quote / Code / Divider,
  showing what you are *in*, replacing seven buttons.
- **Overflow tray** — everything not in the bar, grouped Marks / Blocks / Align /
  Insert.
- **Link popover** — replaces `window.prompt()`, which could not show the current
  href, could not offer "open in new tab", and is suppressed entirely by some
  browsers (where the link button silently did nothing).
- **Emoji picker** — a curated set, no dependency. GIF/sticker tabs are not drawn:
  there is no Tenor integration to draw them from.
- **Mentions everywhere** — lifted out of the comment editor, so threads, replies and
  PMs get them. An admin can switch them off site-wide.
- **Quote as a dismissible context strip**, not markup pasted into the body, so the
  reply a member types stays theirs to edit.
- **Write / Preview**, real FontAwesome icons, and the dead "Ctrl+Enter to post"
  string replaced by the shortcut *inside* the button.

### The tool set is an admin's choice

`ACP → Appearance → Composer`: one row per tool with Bar / Tray / Off, a live preview
of the bar in the admin's order, and the mentions switch. Autosaves. The config lives
in `settings` (`composer.config`), is read by a public `GET /appearance/composer`, and
the ACP writes the same query key the editors read — so every open composer restyles
the moment it saves. Verified end to end: promoting Underline and switching
Superscript off changed the live editor's bar and emptied it from the tray.

⚠ `resolveComposerConfig` (contracts, 10 tests) is the guard between a settings blob
and every member's toolbar: unknown ids dropped, duplicates removed, `off` beating
`bar`, and a MISSING row falling back to the shipped six — which is not the same as a
stored empty bar an admin chose.

### Plugins keep working, and get the redesign for free

`MiniEditor` and `ForumEditor` are now thin adapters over `Composer` with their exact
props and handles. They are host globals that BUILT bundles import, so the shipped
forum and messaging plugins get the new editor with **no rebuild** — verified live on
the forum's new-thread page. `submitInBar={false}` keeps those callers' own Post
buttons from being doubled.

### Bugs found on the way

1. **`.nvc` + `.nvc--collapsed`** — the base class sets `flex-direction: column`, so
   the collapsed row rendered as a 138px stack instead of a 58px row. The collapsed
   button no longer wears the open shell's class.
2. **The server default was empty.** `resolveComposerConfig(null)` answers "nothing in
   the bar", so a site that had never opened the ACP page got a toolbar with only the
   overflow button. The endpoint now distinguishes a missing row from an empty one.
3. **StarterKit 3.x already bundles Link and Underline** — both old editors added the
   packages again, so TipTap warned `Duplicate extension names found:
   ['link','underline']` and which one won was undefined. Configured through the kit.
4. **Mention avatars were broken** — the old list rendered `/uploads/${avatar}` on a
   value `/users/search` had already resolved to a full URL.

`GET /users/search` also carries the primary group's name now, so the mention row can
say "Administrator" beside a username (ordered by `primaryGroupOrder`, like every
other read of `groups[0]`).

**Not built, and why:** attachments (the forum's endpoint needs a post that does not
exist yet while composing; the other three surfaces have no endpoint at all — the
paperclip is disabled there with the reason in its tooltip, per your call), the GIF
picker (no service configured) and "Draft saved" (no draft endpoint).

Files: `components/composer/{Composer.tsx,Composer.scss,composerTools.tsx,mentions.tsx,
popovers.tsx,useComposerConfig.ts,Composer.test.tsx}`, `components/{MiniEditor,
ForumEditor}.tsx` (adapters; both `.scss` deleted), `contracts/src/composer.ts` +
test, `appearance.routes.ts`, `users.repository.ts`,
`features/admin/pages/ComposerSettings.{tsx,scss}`, `useAcpNav.ts`, `App.tsx`,
`ArticleReaderPage.{tsx,scss}`, `ProfilePage.tsx`, messaging's `ConversationPage.tsx`
(opts into `dock` at its next build), `locales/*/{common,acp}.json`.

---

# Account settings + Badges + docs (earlier the same day)

## Account settings, rebuilt

From `nodevo-redesign/Profile settings redesign`. A sticky rail (settings search + the
five sections, each carrying one live fact — "PIN off", "6 on") beside always-open
cards. **Every accordion is gone**, and `components/AccordionSection.tsx` with them —
an accordion hides the one thing a settings page is for.

- **Profile**: Photo · Bio · Links · Profile information · plugin cards, with a sticky
  **live preview** of the public profile beside them. The preview is drawn from the
  real account (cover, avatar, group badge, join date, counts); only the bio and links
  follow what is being typed.
- **Security**: a status strip (PIN, sessions, email — every value real), then Email,
  Username (with its history in the SAME card), Password, PIN, Sessions.
- **Notifications**: one event × channel matrix. An em dash where a channel does not
  exist, never a disabled switch.
- **Preferences**: Appearance (theme/language/font) · Badges · Reading & motion.
- **Privacy**: every visibility answer in ONE list, then Wall & social.

### The save model

The mockup shipped a `saveMode` prop because its author could not decide. Resolved per
tab, by what the control is: a **save bar** where values are typed (Profile, Privacy),
**instant** where a switch or picker takes effect on click (Notifications, Preferences
— the theme IS the preview), and **per-card buttons** in Security, where each action
has consequences outside the page. ⚠ The bar counts CHANGED FIELDS by diffing against
the server, not keystrokes, and Profile sends only what changed.

### Asked for, but absent — and why

Deactivate account and Remove photo have **no endpoints**; both were omitted rather
than drawn as buttons that cannot work. "Password changed 3 months ago" is not data the
API keeps (the third status card is the email address). The email code expires after
**30** minutes, not the mockup's 15.

### Server

`GET /account/sessions` rows now carry `current` (from `req.sessionId`) so the list can
say "This device" instead of offering to revoke the session you are reading from; the
Photo hint states the member's real rank limit from `GET /users/me/limits`.

### ⚠ Why `account-*` class names survived

The **shipped** forum bundle renders `.account-hint/-field/-label/-input/-actions/
-toggle*`. Those were restyled, never renamed; `acct-*` is the new vocabulary. Verified
live: the Forum Signature card and the forum privacy switch both render correctly.

### Three bugs that every check passed

1. **`> svg` is not a safe icon selector.** With a FontAwesome kit, `Icon.tsx` renders
   `<span><i/></span>`, so `> svg` stopped matching (a field glyph escaped its input)
   and `> span` started matching the ICON wrapper (`flex: 1` shoved every nav label
   right). Icons carry a class now.
2. `deviceName` called every iPhone **macOS** — an iOS user-agent says "like Mac OS X".
3. …and every Edge/Opera **Chrome** — a regex alternation matches by POSITION, not by
   priority. Both caught by the new test.

Files: `features/account/{AccountPage.tsx,AccountPage.scss}`, `components/{AccountCard,
SaveBar}.tsx`, all five `tabs/*.tsx`, `account.test.ts` (9 tests), `account.service.ts`,
`account.controller.ts`, `locales/*/account.json` (37 dead keys dropped, ~90 added),
`components/AccordionSection.tsx` deleted.

---

# Badges + docs (earlier the same day)

Two pieces of work: the **badges ACP page rebuilt** from
`nodevo-redesign/Badge page redesign`, and the **plugin/API documentation** pass
finished and verified against the code.

`pnpm backbone:check` green — typecheck 30/30, lint 0 errors, API **388** tests,
web **742** (7 new), build clean. **No migrations.**

Verified in a running browser (light AND dark, wide and at 605px): the list, the
holders drawer, both modals, create, delete-with-confirm, search, filter, sort.

---

## ACP → Badges

The page was one settings card with a flat list. It is now organised by **how a
badge is come by**, because that is the job an admin arrives with: a rule they
configure once (automatic) or a decision they make per member (by hand).

- **Header** carries the catalogue's totals (badges / awards out there) beside the
  one action.
- **Toolbar**: search over name AND key (a key is what an admin copies out of a
  seed or a plugin), filter by how it is earned, sort by order / name / holders.
  `arrangeBadges` is a pure function with its own test — the page renders whatever
  it returns. The default sort re-sorts NOTHING: the server answers `displayOrder`
  then `name`, and re-sorting on `displayOrder` alone would drop that tiebreak.
- **Two groups**, each with its own empty state and invitation. ⚠ A filter HIDES
  the other group rather than emptying it — "By hand" showing an empty state
  because you filtered to Automatic explains nothing.
- **A row** shows the mark, name, key, System pill, and a sub-line that depends on
  the kind: for an automatic badge the thresholds ARE the badge, so its
  description is the least useful thing to print.
- **Holders drawer** (new): who holds it, how they came by it, when, and revoke.
  It opens over the list so closing puts the admin back where they were. Awarding
  is still on the member's page — a badge is given to a person.
- **Delete asks first** (new). It cascades every award; an admin tidying the
  catalogue could quietly undo work that was handed out one member at a time.

### The modal

A rail (live preview of the mark being edited + three tabs) beside one pane:
**Details** (name, key, description, order), **Appearance** (colour + glyph),
**Reward system** (banner + thresholds + a plain-English summary). The reward tab
carries an "On" mark in the rail — the one tab whose state changes what the badge
DOES.

⚠ The glyph half is the shared **`IconPicker`**, not a grid of this page's own: it
is the only surface that knows about the site's icon kit, pinned styles and the
bundled fallback, and it reads the legacy `faStar` values badges already store.

### Shared, not copied

`.mnt-seg` / `.mnt-banner` — the segmented picker and the switch banner the
maintenance card introduced — are now **`.acp-seg` / `.acp-banner`** in
`acpSystem.scss`, because a second page needed both. `MaintenanceSettings.tsx`
renames with them. `Toggle` and `NumberStepper` come from `AcpControls`; the
stepper is the redesign's −/+ Order control exactly.

`acpIcons.tsx` gains `x`, `heart` and `hand`.

### Server

- `GET /admin/badges/:id/holders` now carries **`auto`**, and the response is typed
  (`BadgeHolder` in contracts). ⚠ It is NOT derivable from `note`: an admin may
  hand a badge over without writing a reason, and that award is still theirs.
- `GET /admin/badges` carries **`holderPreview`** — up to three recent holders for
  the faces on the holders button. One extra relation query for the whole page.

### i18n

The `badges` block was rewritten in all five locales: 27 dead keys dropped (the
awarding UI moved to the member page long ago), ~50 added, `holdersShort` and the
delete confirmation pluralised properly.

### Two bugs the browser found, that every check had passed

1. `.inp` is `width: 100%`, and at equal specificity the shared rule won — the
   threshold input ate the whole row and **squeezed every metric label to one
   letter**. Fixed with `input.bdg-criterion__val`.
2. Stacking the modal's grid at phone width left both rows sized to their content,
   so the modal grew past `max-height` and **the footer — Cancel and Save — was
   clipped off the bottom with no way to reach it**. It is a flex column there
   now, with the pane scrolling.

---

## Documentation (`docs/`)

- **`docs/plugin-registries.md`** (new): every extension point a plugin has, with
  the rules that make disabling safe. Verified against `plugin-sdk`/`plugin-kit`
  and the API's own context.
- **`docs/API.md`**: badges, profile views, icon kit/style, profile cover.
- **`docs/plugin-blocks.md`**: icons in a block — what happens for free, the
  positional `iconOverrides` key, and an icon as a PROP (`format: "icon"`).
- **`TokenIcon` is now a host global** (`webTokenIcon`) — the icon-as-a-prop recipe
  needs something to draw the token with.
- **BUGS.md #7**: plugin default permissions come BACK after a restart.
  `registerPermissions` upserts each `defaults` grant and `onEnable` runs on every
  boot, so a grant an admin revoked is silently re-created. The code comment
  already says it should only apply on first install.

---

## Files

**ACP page**
- `apps/web/src/features/admin/pages/BadgesPage.tsx` — rebuilt
- `apps/web/src/features/admin/pages/BadgesPage.scss` — rebuilt
- `apps/web/src/features/admin/pages/BadgesPage.test.ts` — new (7 tests)
- `apps/web/src/features/admin/pages/acpSystem.scss` — `.acp-seg`, `.acp-banner`
- `apps/web/src/features/admin/pages/acpIcons.tsx` — `x`, `heart`, `hand`
- `apps/web/src/features/admin/pages/MaintenanceSettings.tsx` — renamed classes
- `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` — `badges` block

**Server / contracts**
- `packages/contracts/src/badges.ts` — `BadgeHolder`, `BadgeHolderPreview`
- `apps/api/src/modules/badges/badges.service.ts` — `auto`, `holderPreview`
- `apps/api/src/modules/badges/badges.types.ts` — re-export

**Docs**
- `docs/plugin-registries.md` (new), `docs/API.md`, `docs/plugin-blocks.md`
- `apps/web/src/plugins/host-globals.ts` — `webTokenIcon`
- `BUGS.md`

**Following a thread (forum plugin — gitignored)**
- `server/forum.service.ts` — `setThreadSubscription`, `notifyThreadSubscribers`,
  `viewer_is_subscribed` in `getThread`, `follow` on `createThread`, the OP-edit
  fan-out in `editPost`, and `dispatchMentionNotifications` now returns its ids
- `server/forum.router.ts` — `PUT /threads/:threadId/subscription`, `follow` on create
- `server/index.ts` — `forum.thread_updated` registered
- `web/pages/ForumThreadPage.tsx` — `FollowButton`, `viewer_is_subscribed`
- `web/pages/NewThreadPage.tsx` — the Follow pill, Options row no longer mod-gated
- `web/locales/{en,de,es,fr,pt}/forum.json` — `newThread.optFollow`,
  `thread.follow` / `.following` / `.followHint` / `.followingHint`

**Forum index redesign (forum plugin — gitignored)**
- `server/forum.service.ts` — `listRecentThreads`, `listTopContributors`,
  `listRecentTags`, `listMySubscriptions` (+ `INDEX_SCAN_LIMIT`)
- `server/forum.router.ts` — the four `/index/*` routes
- `shared/layoutTemplates.ts` — `forum.index`'s `defaultDocument` is now the composition
- `web/indexStyles.ts` — new; the injected stylesheet
- `web/blocks/indexShared.tsx` — new; `Card`, `Empty`, `timeAgo`, `FA_ICONS`
- `web/blocks/{ForumIndexHeadBlock,ForumRecentThreadsBlock,ForumCategoryListBlock,
  ForumTopUsersBlock,ForumSubscriptionsBlock,ForumRecentTagsBlock}.tsx` — new
- `web/index.tsx` — registers the six blocks, injects the stylesheet
- `web/locales/{en,de,es,fr,pt}/forum.json` — the `index` block

**Thread page redesign (forum plugin — gitignored)**
- `server/forum.service.ts` — `getThreadSummary`
- `server/forum.router.ts` — `GET /threads/:threadId/summary`
- `web/threadStyles.ts` — new; the injected `.ft-` stylesheet
- `web/pages/ForumThreadPage.tsx` — sticky bar, header, PostCard, `ThreadRail`,
  pagination row, report action, and the four fixes above
- `web/locales/{en,de,es,fr,pt}/forum.json` — the new `thread.*` keys
- `manifest.json` / `package.json` / `CHANGELOG.md` / `changelog/2026-09-12-v1.4.0.md`
