# Plugin pages in the ACP

## Look like core

Your plugin's admin pages should look exactly like ours. Not close: the same font,
weights, sizes and spacing. An admin shouldn't be able to tell which parts of the ACP
came from a plugin.

The only way that holds up is to use core's own classes and components instead of
copying them. Numbers picked by hand always drift; one of our own plugins ended up with
weight 700 where core uses 600, and at font sizes core doesn't use anywhere.

**Don't set `font-family`, `font-weight` or `font-size` in a plugin's ACP panel.** Use
these instead. They're all global once the ACP has loaded, so your bundle can rely on
them without importing any core CSS:

| You need | Use |
|---|---|
| A setting row | `.set-row` > `.set-row__label` + `.set-row__desc` + `.set-row__control` |
| A group of rows | `.set-rows` |
| A card or panel title with a subtitle | `.set-card__titles` > `h3` + `p` (works on its own) |
| Secondary or description text | `.set-row__desc` |
| A text input / a select | `.acp-input` / `.acp-select` |
| Buttons | `Button` from `@web/components/AcpControls` (`variant`: primary, ghost, danger, ghost-danger) |
| A toggle, text field or number stepper | `@web/components/AcpControls` |
| An icon choice | `IconPicker` from `@web/components/IconPicker` (host global `webIconPicker`) |

The ACP has one button size. `.btn-sm` and `.btn-lg` still work in older plugins, but in
the ACP they render at the same size as every other button, so leave them out.

Externalize the controls like any other host global:

```ts
"@web/components/AcpControls": `${H}.webAcpControls`,
```

Keep your plugin's CSS to **layout**: flex, grid, gaps, margins. If a rule in your
stylesheet mentions a font, that's a bug.

## Saving: the save bar

Nothing in the ACP goes live until the admin saves. Every settings surface on a page
registers what it has changed, and one **save bar** at the bottom of the screen adds it
all up. The admin reviews the changes, then saves or discards them together. Leaving the
page with unsaved changes stops at the bar and asks first.

Your plugin's settings join that bar. You don't build a Save button, and you don't build
a status line.

Working examples: `xentium-advanced-moderation` (`AdvModPage`, a settings page with a
secret field), `xentium-forum` (`ForumSettingsPage`, `ForumGroupProgression`) and
`xentium-shoutbox` (`ShoutboxAcpPage`, `ShoutboxGroupLimits`).

### What joins the bar

**Settings join the bar.** That's any form that edits *existing* settings, where every
field already has a value and the page is a view of what's on the server:

- plugin settings pages
- per-group panels (the `groupConfigPanel` slot, see below)
- toggles, limits, thresholds, dropdowns

**Everything else keeps its own button.** The bar is wrong when there's no current value
yet, or when the action must happen on its own:

| Case | Why | What to do |
|---|---|---|
| Create/edit dialogs for **things** (a category, a room, a filter rule) | The draft isn't real until you commit it, and a half-typed name must not create a row | Save / Cancel buttons |
| **Secrets** and write-only fields (API keys, tokens) | Never part of a draft; never store a half-typed credential | A dedicated Set / Remove |
| **Destructive** actions (delete, purge, reset) | You need to know the admin meant it | A confirm dialog |

### Step by step

1. **Externalize the hook** in `vite.config.ts`, next to the others:

   ```ts
   "@web/hooks/useDraft":      `${H}.webUseDraft`,
   "@web/components/SaveChip": `${H}.webSaveChip`,   // only for standalone pages
   ```

2. **Register your draft.** The server's value is the baseline; the bar counts a change
   as soon as your form differs from it.

   ```tsx
   import { useDraft } from "@web/hooks/useDraft";

   const { data } = useQuery({ queryKey: ["myplugin", "settings"], queryFn: … });
   const [form, setForm] = useState<Settings | null>(null);
   useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

   const saveMut = useMutation({
     mutationFn: (payload: Settings) => api.put(`${BASE}/admin/settings`, payload),
     onSuccess:  () => qc.invalidateQueries({ queryKey: ["myplugin", "settings"] }),
   });

   useDraft({
     value: form,
     savedValue: data,
     label: "My plugin",
     onSave: (v) => saveMut.mutateAsync(v),   // return the promise
     onDiscard: () => setForm(data ?? null),
   });
   ```

3. **On a standalone page**, one with its own `pg-head`, show the status chip in the
   header. It speaks for the whole page: all saved, unsaved changes, saving, or not
   saved. A panel inside one of our pages shows nothing; the page already has a chip.

   ```tsx
   <SaveChip saving={false} />
   ```

### The options

| Option | |
|---|---|
| `value`, `savedValue` | The form, and what the server has. `savedValue` is `undefined` while loading. |
| `onSave(value)` | Persist. **Return the promise** (`mutateAsync`) so the bar knows when it finished and why it failed. |
| `onDiscard()` | Reset the form to `savedValue`. Without it, Discard reloads the whole page to reset you. |
| `label`, `section` | How the review list names your change. |
| `describe(value, saved)` | One line per changed field, `{ key, label, from, to, revert }`, for a precise review list and per-field Revert. |

To fail a save on purpose, for a value you can see is invalid, throw
`new DraftFailure(message)` from `onSave`. The bar shows the message and keeps the change.

### Things that trip people up

- **Don't toast success.** The bar says the changes are saved. Don't toast errors from
  your draft's mutation either: a failure shows in the bar with the server's message.
- **`savedValue` has to be `undefined` while loading**, not `null` or `{}`. The draft
  waits until it's defined, which is what stops a freshly loaded form from counting as a
  change.
- **Normalize both sides** when your draft and the server row don't have the same shape.
  Key order doesn't matter, but `undefined` vs `null` does. A panel for a group that has
  no row yet should compare an all-`null` object with an all-`null` draft:

  ```ts
  type Form = Omit<Row, "groupId">;
  const normalize = (r: Partial<Row> | undefined): Form => ({
    maxFoo: r?.maxFoo ?? null,
    minBar: r?.minBar ?? null,
  });
  useDraft({ value: form, savedValue: rows ? normalize(find(rows)) : undefined, … });
  ```

- **Keep edits to several things in one draft.** If your page edits a list of items and
  shows one at a time, keep every item's edits in a map on the page, and register that
  map as one draft. Switching items isn't leaving the page, so an unsaved edit to the
  item you just left must still be there.

### Older plugins

`useAutosave` from `@web/hooks/useAutosave` (`webUseAutosave`) is the same hook under
its old name, so a plugin built for autosave joins the bar without a rebuild. If its
`onSave` returns nothing, the bar treats the save as done once `savedValue` catches up
with what was sent. Outside the ACP, where there's no bar, the hook still autosaves.

## Per-group panels (`groupConfigPanel`)

Settings that belong to a group (permissions, progression) go on **core's group page**
(ACP → Members → Groups → a group), not on a page of their own. Register a panel and it
shows up as a tab of that page, after our "Progression" tab:

```tsx
slotRegistry.registerGroupConfigPanel({
  id: "my-plugin", label: "My Plugin", component: MyGroupPanel, order: 10,
});
// your component gets { groupId, groupName }
```

Your plugin owns the data. Core passes in the group and never learns your schema. These
panels are settings, so they **join the save bar** like any other ACP form.

The group page has one status chip for everything on it, your tab included, so render no
indicator of your own. A panel that already renders `AutosaveStatus` is fine as it is: on
the group page it draws nothing.

If the values are meant to be *earned* rather than assigned, resolve them against the
user's progression rung with `host.progression.getEffectiveGroupId`, and add any
promotion thresholds through `ctx.registerProgressionCriteria`. That way core, the forum
and the shoutbox all follow one rule: a group that isn't on the ladder grants nothing.

## What core gives you

- `useDraft(options)` and `DraftFailure` in `apps/web/src/hooks/useDraft.ts`, exposed as
  `window.__XENTIUM_HOST__.webUseDraft`. `useAutosave` is the same hook under its old name
  (`webUseAutosave`).
- `<SaveChip />` in `apps/web/src/components/SaveChip.tsx`, exposed as `webSaveChip` (and
  as `webAutosaveStatus`, the older name).
- `registerGroupConfigPanel(slot)` in `apps/web/src/plugins/slotRegistry.ts`.
