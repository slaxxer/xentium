# Plugin ACP surfaces

## Typography and controls — the hard rule

**A plugin's admin surface must be indistinguishable from core's.** Not similar:
identical font, weights, sizes and spacing. An admin should not be able to tell
which parts of the ACP came from a plugin.

The only reliable way to get that is to use core's OWN classes and components,
never to re-implement them. Hand-picked numbers always drift — the launch plugin
had already ended up at weight 700 where core uses 600, at sizes core does not
use anywhere.

**Never set `font-family`, `font-weight` or `font-size` in a plugin ACP panel.**
Use these instead — all global once the ACP is mounted, so a plugin bundle can
rely on them without importing any core CSS:

| Need | Use |
|---|---|
| A setting row | `.set-row` > `.set-row__label` + `.set-row__desc` + `.set-row__control` |
| A group of rows | `.set-rows` |
| A card/panel title + subtitle | `.set-card__titles` > `h3` + `p` (works standalone) |
| Any secondary/description text | `.set-row__desc` |
| Text input | `.acp-input` · select: `.acp-select` |
| Buttons | `.btn-primary` / `.btn-ghost` / `.btn-ghost-danger`, plus `.btn-sm` |
| Toggle, text field, number stepper | `@web/components/AcpControls` |

Externalise the controls like any other host global:

```ts
"@web/components/AcpControls": `${H}.webAcpControls`,
```

Plugin-side CSS is for LAYOUT only — flex, grid, gaps, margins. If a rule in a
plugin stylesheet mentions a font, it is a bug.

# Plugin ACP autosave

How a plugin's admin surfaces persist changes. Xentium ACP **config** pages have no
Save button — they save on change, with a status indicator in the header. A plugin
must follow the same convention so its pages don't feel foreign inside the ACP.

Live examples: `nodevo-advanced-moderation` (`AdvModPage` — settings page with a
secret field), `nodevo-forum` (`ForumSettingsPage`, `ForumGroupProgression`),
`nodevo-shoutbox` (`ShoutboxAcpPage`, `ShoutboxGroupLimits`).

## When autosave applies

**Autosave — config.** A form that edits *existing* settings, where every field has
a current value and the page is a view onto server state:

- plugin settings pages
- per-group config panels (the `groupConfigPanel` slot — see below)
- toggles, numeric limits, thresholds, dropdowns

**Explicit Save — everything else.** Autosave is wrong when a "current value" does
not exist yet or when a half-typed value is dangerous:

| Case | Why | Pattern |
|---|---|---|
| Create/edit **entity** modals (a category, a room, a filter rule) | The draft isn't state until it's committed; a half-typed name must not create a row | Save / Cancel buttons |
| **Secrets** and write-only fields (API keys, tokens) | Never persist a partially-typed credential | Dedicated Set / Remove |
| **Destructive** actions (delete, purge, reset) | Needs intent | Confirm dialog |

`ForumCategoriesPage`'s node editor keeps Save buttons for exactly the first
reason; `AdvModPage` excludes its proxycheck key from autosave for the second.

## Recipe

1. **Externalize the bridges** in `vite.config.ts` (alongside the others):

   ```ts
   "@web/hooks/useAutosave":   `${H}.webUseAutosave`,
   "@web/components/SaveChip": `${H}.webSaveChip`,   // standalone pages only
   ```

   `@web/components/AutosaveStatus` still resolves — it is an alias for
   `SaveChip` — but new code should import `SaveChip`.

2. **Wire the hook.** The server value is the baseline — `useAutosave` saves when
   the draft diverges from it, after a quiet period (600 ms default):

   ```tsx
   import { useAutosave } from "@web/hooks/useAutosave";
   import { SaveChip } from "@web/components/SaveChip";

   const { data } = useQuery({ queryKey: ["myplugin", "settings"], queryFn: … });
   const [form, setForm] = useState<Settings | null>(null);
   useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

   const saveMut = useMutation({
     mutationFn: (payload: Settings) => api.put(`${BASE}/admin/settings`, payload),
     onSuccess:  () => qc.invalidateQueries({ queryKey: ["myplugin", "settings"] }),
     onError:    (e) => swalToast(apiErrorMessage(e)),
   });

   useAutosave({ value: form, savedValue: data, onSave: (v) => { if (v) saveMut.mutate(v); } });
   ```

3. **Show the indicator** in the page/panel header — it is the affordance that
   replaces the Save button, so it is not optional:

   **A panel nested in a host page reports; it does NOT render a chip.** A
   plugin section on ACP → Settings sits under a page that already shows one, and
   two indicators on one screen say the same thing twice — and can disagree while
   a save is in flight. Report instead:

   ```tsx
   import { useAutosave, useReportSaving } from "@web/hooks/useAutosave";

   useAutosave({ value: form, savedValue: data, onSave: (v) => saveMut.mutate(v) });
   useReportSaving(saveMut.isPending);   // the host page's chip speaks for you
   ```

   A **standalone** plugin ACP page — one that owns its own `pg-head` — renders
   the chip itself, because there is nothing above it to report to:

   ```tsx
   <SaveChip saving={saveMut.isPending} />
   ```

   Either way it is core's own component and core's own engine. Do not hand-roll
   an indicator: there used to be two, and the plugin-facing one was hardcoded
   English.

### Rules that keep it correct

- **Do not toast on every success.** The indicator already reports it; a toast per
  debounce-flush stacks up while the admin tabs through fields. Toast on **error**
  only.
- **`savedValue` must be `undefined` while loading**, never `null` or `{}`.
  Autosave stays idle until it resolves, which is what stops the freshly-seeded
  form from immediately saving itself back.
- **Normalize both sides** when the draft and the server row aren't the same
  shape. The hook deep-compares via `JSON.stringify`, so key order and
  `undefined`-vs-`null` matter. A panel whose group has no row yet should compare
  an all-`null` object against an all-`null` draft:

  ```ts
  type Form = Omit<Row, "groupId">;
  const normalize = (r: Partial<Row> | undefined): Form => ({
    maxFoo: r?.maxFoo ?? null,
    minBar: r?.minBar ?? null,
  });
  useAutosave({ value: form, savedValue: rows ? normalize(find(rows)) : undefined, … });
  ```

- **Don't hand-roll the debounce.** A local `setTimeout` + `useRef` baseline looks
  equivalent and isn't: it bypasses the query cache (so other views go stale) and
  it is easy to latch the indicator into a permanent "Saved" state that never
  reports saving again. Both bugs shipped in the shoutbox before it moved to the
  shared hook.

## Per-group panels (`groupConfigPanel`)

RBAC/progression-adjacent config belongs in the **core Group settings dialog**, not
a standalone plugin page. Register a panel and it renders as a tab beside core's
own "Progression" tab:

```tsx
slotRegistry.registerGroupConfigPanel({
  id: "my-plugin", label: "My Plugin", component: MyGroupPanel, order: 10,
});
// component receives { groupId, groupName }
```

The plugin owns the data — core passes the group context and never learns the
plugin's schema. These panels are config, so they **autosave**; see
`ShoutboxGroupLimits` / `ForumGroupProgression`.

If the panel's values are meant to be *earned* rather than assigned, resolve them
against the user's progression rung with `host.progression.getEffectiveGroupId`,
and contribute any promotion thresholds via `ctx.registerProgressionCriteria`
(§38). That keeps one rule across core, forum and shoutbox: a group that is not on
the ladder grants nothing.

## What core provides

- `apps/web/src/hooks/useAutosave.ts` → `useAutosave({ value, savedValue, onSave, delay? })`,
  bridged as `window.__XENTIUM_HOST__.webUseAutosave`.
- `apps/web/src/components/AutosaveStatus.tsx` → `<AutosaveStatus saving />`,
  bridged as `webAutosaveStatus`.
- `apps/web/src/plugins/slotRegistry.ts` → `registerGroupConfigPanel(slot)`.

## Known gap

`AutosaveStatus` hardcodes its English strings ("Saving…" / "Changes save
automatically") — it is not wired to i18next, so a plugin cannot localize the
indicator the way it localizes its own labels ([plugin-i18n](plugin-i18n.md)).
Use it anyway for consistency; localizing it is a core change.
