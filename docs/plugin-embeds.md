# Plugin embeds

An embed is something your plugin keeps in its own tables but shows inside content someone else owns. A poll in a forum post or an article is the first one.

The content never stores your data. It stores a placeholder:

```html
<div class="xt-embed" data-xt-embed="poll" data-id="3f2c1e0a-…"></div>
```

In an article (stored as ProseMirror JSON) the same thing is an `xtEmbed` node with `{ type, id }`. Wherever the content is drawn, core swaps the placeholder for your renderer.

## The four pieces

You register two things on the server and two in the browser.

### Server: the embed

```ts
ctx.registerEmbed?.({
  type: "poll",
  // Called every time a post or article is saved, with the ids of YOUR type it now
  // holds. Can be an empty list, so you can release what the writer deleted.
  sync: async (host, ids) => { /* attach ids to host.kind + host.id */ },
  // Called when the post or article is deleted for good.
  remove: async (host) => { /* drop everything attached to it */ },
});
```

`host` is `{ kind, id, authorId }`. Attach only items the content's own writer created (`authorId`), or someone could pull your poll into their post by pasting its id.

Both calls must be safe to repeat. If one throws, core logs it and the member's save still goes through.

### Server: visibility

Before you return anything about an embedded item, ask whether the viewer may see the content it sits in:

```ts
const visible = await ctx.host.content?.canView(poll.hostKind, poll.hostId, viewerId);
```

The answer is `false` for an unknown kind, a disabled owner or any error. Treat `false` as "not found" (404), never 403, so a private board does not leak through an embed. If `host.content` is missing (an older core), treat it as `false` too.

If your plugin owns content that can hold embeds, answer for it:

```ts
ctx.registerContentKind?.({
  kind: "forum.post",
  canView: async (id, viewerId) => { /* every rule your own read path applies */ },
});
```

When you save or delete that content, tell core:

```ts
await ctx.host.content?.syncEmbeds({ kind: "forum.post", id, authorId }, sanitizedHtml);
await ctx.host.content?.removeEmbeds({ kind: "forum.post", id });
```

Core does this for articles itself.

### Browser: the renderer

```tsx
slotRegistry.registerEmbed({ type: "poll", component: PollCard });
```

`PollCard` gets `{ id }` and loads its own data from your permission-checked endpoint. If your plugin is disabled, readers see a short "not available" note in its place. If your component crashes, only the embed is replaced, never the post around it.

### Browser: the Composer tool

```tsx
slotRegistry.registerComposerTool({
  id: "xentium-polls.poll",
  icon: faChartSimple,
  get label() { return t("polls:tool"); },
  surfaces: ["forum.post", "article"],
  permission: "polls.create",
  panel: ({ onInsert, onClose }) => (
    <PollEditor onCancel={onClose} onCreated={(id) => onInsert({ type: "poll", id })} />
  ),
});
```

The button shows up only in a Composer whose `surface` you list and only for members holding `permission`. Your panel creates the item through your own endpoint, then calls `onInsert`, and the Composer puts the placeholder into the text.

## Drawing posts that may hold embeds

If your plugin shows stored rich text, draw it with `RichHtml` (`@web/components/RichHtml`, host global `webRichHtml`) instead of `dangerouslySetInnerHTML`:

```tsx
<RichHtml className="xt-rich" html={post.body} />
```

It renders the HTML as it is and puts each embed's renderer into its placeholder. Pass a `surface` to every `Composer` you mount (`forum.post`, `article`); a Composer without one offers no plugin tools.

## Rules for the placeholder

- `type`: lowercase letters, digits and dashes, starting with a letter, up to 40 characters.
- `id`: letters, digits, `_` and `-`, up to 64 characters. UUIDs fit.
- One plugin per type.

The same rules live in `@xentium/contracts` (`EMBED_TYPE_RE`, `EMBED_ID_RE`, `extractEmbeds`). The server sanitizer, the editor and the extractor all use them, so a placeholder that passes one passes all three.
