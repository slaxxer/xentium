# Plugin pages in the ACP

## Look like core

Your plugin's admin pages should look exactly like ours. Not close: the same font,
weights, sizes and spacing. An admin shouldn't be able to tell which parts of the ACP
came from a plugin.

The only way that holds up is to use core's own classes and components instead of
copying them. Numbers picked by hand always drift; our own launch plugin ended up with
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
| Buttons | `.btn-primary` / `.btn-ghost` / `.btn-ghost-danger`, plus `.btn-sm` |
| A toggle, text field or number stepper | `@web/components/AcpControls` |

Externalize the controls like any other host global:

```ts
"@web/components/AcpControls": `${H}.webAcpControls`,
```

Keep your plugin's CSS to **layout**: flex, grid, gaps, margins. If a rule in your
stylesheet mentions a font, that's a bug.

## Saving: autosave

Settings pages in our ACP don't have a Save button. They save as you change things and
show a status chip in the header. Your plugin should work the same way so it doesn't
feel out of place.

Working examples: `xentium-advanced-moderation` (`AdvModPage`, a settings page with a
secret field), `xentium-forum` (`ForumSettingsPage`, `ForumGroupProgression`) and
`xentium-shoutbox` (`ShoutboxAcpPage`, `ShoutboxGroupLimits`).

### When to autosave

**Autosave settings.** That's any form that edits *existing* settings, where every field
already has a value and the page is a view of what's on the server:

- plugin settings pages
- per-group panels (the `groupConfigPanel` slot, see below)
- toggles, limits, thresholds, dropdowns

**Use an explicit button for everything else.** Autosave is wrong when there's no
current value yet, or when saving something half-typed would be dangerous:

| Case | Why | What to do |
|---|---|---|
| Create/edit dialogs for **things** (a category, a room, a filter rule) | The draft isn't real until you commit it, and a half-typed name must not create a row | Save / Cancel buttons |
| **Secrets** and write-only fields (API keys, tokens) | Never store a half-typed credential | A dedicated Set / Remove |
| **Destructive** actions (delete, purge, reset) | You need to know the admin meant it | A confirm dialog |

The forum's category editor (`ForumCategoriesPage`) keeps its Save buttons for the
first reason, and `AdvModPage` leaves its proxycheck key out of autosave for the second.

### Step by step

1. **Externalize the bridges** in `vite.config.ts`, next to the others:

   ```ts
   "@web/hooks/useAutosave":   `${H}.webUseAutosave`,
   "@web/components/SaveChip": `${H}.webSaveChip`,   // only for standalone pages
   ```

   `@web/components/AutosaveStatus` still works (it's an alias for `SaveChip` that we
   keep for older plugins), but import `SaveChip` in new code.

2. **Wire up the hook.** The server's value is the baseline: `useAutosave` saves once
   your draft differs from it and you've stopped typing for a moment (600 ms by
   default).

   ```tsx
   import { useAutosave } from "@web/hooks/useAutosave";
   import { SaveChip } from "@web/components/SaveChip";

   const { data } = useQuery({ queryKey: ["myplugin", "settings"], queryFn: … });
   const [form, setForm] = useState<Settings | null>(null);
   useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

   const saveMut = useMutation({
     mutationFn: (payload: Settings) => api.put(`${BASE}/admin/settings`, payload),
     onSuccess:  () => qc.invalidateQueries({ queryKey: ["myplugin", "settings"] }),
     onError:    (e) => toast.error(apiErrorMessage(e)),
   });

   useAutosave({ value: form, savedValue: data, onSave: (v) => { if (v) saveMut.mutate(v); } });
   ```

3. **Show the status.** It replaces the Save button, so it isn't optional. Where it
   goes depends on where your UI lives.

   **A panel inside one of our pages reports to it instead of showing its own chip.**
   A plugin section on ACP → Settings sits under a page that already has a chip. Two
   chips on one screen say the same thing twice, and they can disagree while a save is
   running:

   ```tsx
   import { useAutosave, useReportSaving } from "@web/hooks/useAutosave";

   useAutosave({ value: form, savedValue: data, onSave: (v) => saveMut.mutate(v) });
   useReportSaving(saveMut.isPending);   // the page's chip shows it for you
   ```

   **A standalone plugin page**, one with its own `pg-head`, shows the chip itself,
   because there's nothing above it to report to:

   ```tsx
   <SaveChip saving={saveMut.isPending} />
   ```

   Either way it's our component, translated into every language we ship. Please don't
   build your own indicator.

### Things that trip people up

- **Don't toast every successful save.** The chip already says it's saved. A toast per
  save piles up while the admin tabs through fields. Toast only on **errors**.
- **`savedValue` has to be `undefined` while loading**, not `null` or `{}`. Autosave
  waits until it's defined, which is what stops a freshly loaded form from saving itself
  straight back.
- **Normalize both sides** when your draft and the server row don't have the same shape.
  The hook compares them with `JSON.stringify`, so key order and `undefined` vs `null`
  matter. A panel for a group that has no row yet should compare an all-`null` object
  with an all-`null` draft:

  ```ts
  type Form = Omit<Row, "groupId">;
  const normalize = (r: Partial<Row> | undefined): Form => ({
    maxFoo: r?.maxFoo ?? null,
    minBar: r?.minBar ?? null,
  });
  useAutosave({ value: form, savedValue: rows ? normalize(find(rows)) : undefined, … });
  ```

- **Don't write your own debounce.** A `setTimeout` with a `useRef` baseline looks like
  the same thing, but it isn't. It skips the query cache, so other views go stale, and
  it's easy to get the chip stuck on "Saved" forever. The shoutbox shipped both of those
  bugs before it switched to the shared hook.

## Per-group panels (`groupConfigPanel`)

Settings that belong to a group (permissions, progression) go on **core's group page**
(ACP → Users → Groups → a group), not on a page of their own. Register a panel and it
shows up as a tab of that page, after our "Progression" tab:

```tsx
slotRegistry.registerGroupConfigPanel({
  id: "my-plugin", label: "My Plugin", component: MyGroupPanel, order: 10,
});
// your component gets { groupId, groupName }
```

Your plugin owns the data. Core passes in the group and never learns your schema. These
panels are settings, so they **autosave**; see `ShoutboxGroupLimits` and
`ForumGroupProgression`.

The group page has one save indicator for everything on it, your tab included. Call
`useReportSaving(saving)` and render no indicator of your own. A panel that already
renders `AutosaveStatus` is fine as it is: on the group page it reports to the page's
indicator and draws nothing.

If the values are meant to be *earned* rather than assigned, resolve them against the
user's progression rung with `host.progression.getEffectiveGroupId`, and add any
promotion thresholds through `ctx.registerProgressionCriteria`. That way core, the forum
and the shoutbox all follow one rule: a group that isn't on the ladder grants nothing.

## What core gives you

- `useAutosave({ value, savedValue, onSave, delay? })` and `useReportSaving(saving)` in
  `apps/web/src/hooks/useAutosave.ts`, exposed as `window.__XENTIUM_HOST__.webUseAutosave`.
- `<SaveChip saving />` in `apps/web/src/components/SaveChip.tsx`, exposed as
  `webSaveChip` (and as `webAutosaveStatus`, the older name).
- `registerGroupConfigPanel(slot)` in `apps/web/src/plugins/slotRegistry.ts`.
