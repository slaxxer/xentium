/**
 * The home page, decomposed (ADR-0005).
 *
 * Third page taken apart, after the profile and members. One thing differs, and it
 * simplifies everything: **the home cards share no interaction state.** MeCard,
 * HotThreads, PopularTags and the rest each fetch their own independent thing, so
 * there is nothing for the host to hoist and no context to thread — each block keeps
 * the query it always had. What matters is that none of them takes a data-selecting
 * prop, which is the line `blockRegistry`'s "blocks render, the host fetches" rule
 * actually draws.
 *
 * ## The guest/member split is an audience, not a branch
 *
 * `HomePageContent` used to be `if (!isAuthenticated) return <GuestHome />`. That is
 * now the layout's business: the landing block ships with the `guests` audience and
 * the three-column arrangement with `members`. Same behaviour by default, but an
 * admin can show the hero to everyone, restrict the feed to a group, or replace the
 * landing entirely — none of which was reachable while it was an `if`.
 *
 * ## The rails
 *
 * `.hf-left` / `.hf-right` were sticky flex columns sized by a
 * `var(--sidebar-width) 1fr 300px` grid. `.nv-column` already gave the flex and the
 * gap, so all that was missing was width and stickiness — now `column.width:
 * sidebar | rail` and `column.sticky`, which is why the rails are ordinary tracks
 * rather than bespoke wrappers.
 */
import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { blockPropSchemas } from "@nodevo/contracts";
import { registerBlock } from "../blockRegistry";
import { RankProgress, useRankFor } from "../../features/progression/rank";
import {
  Feed,
  HotThreads,
  MeCard,
  PopularTags,
  SectionNav,
  SpacesCard,
  SuggestedPeople,
} from "../../pages/HomePage";

/** Every home block reads home data, so none is placeable on another template. */
const ON_HOME: { allowedTemplates: string[] } = { allowedTemplates: ["home"] };

/**
 * Registers one propless home card.
 *
 * The schema still comes from `blockPropSchemas`, so a card that later gains a prop
 * gets it from the contract rather than from a shape duplicated here. Indexing that
 * object widens to a union of every core schema, hence the narrowing cast — all nine
 * of these are `z.object({})`.
 */
const simple = (type: string, label: string, Component: () => ReactNode, wide = false) =>
  registerBlock({
    type,
    schema: blockPropSchemas[type as keyof typeof blockPropSchemas] as ZodType<
      Record<string, never>
    >,
    editorMeta: { label, category: "data", ...ON_HOME, ...(wide ? { wide: true } : {}) },
    component: () => <Component />,
  });

// The signed-out landing is decomposed in `guestBlocks.tsx` — its hero copy is block
// props now, which is what made `Appearance → Guest Home` redundant.

// Left rail.
simple("homeMeCard",     "Your card",   MeCard);
simple("homeSectionNav", "Section nav", SectionNav);
simple("homeSpaces",     "Spaces",      SpacesCard);

// Centre.
// The one home card that is a page-width layout rather than a rail card — the
// picker says so when it is offered for the rail.
simple("homeFeed", "Feed", Feed, true);

// Right rail.
/**
 * ⚠ The block KEY stays `homeProgression` — existing home layouts reference it, and
 * renaming a block type orphans it in every stored document. Only what it renders
 * changed: the same `RankProgress` the profile rail draws, about the VIEWER.
 */
registerBlock({
  type:   "homeProgression",
  schema: blockPropSchemas.homeProgression,
  editorMeta: { label: "Rank progress", category: "data" },
  component: ({ context }) => <RankProgress data={useRankFor(context)} />,
});
simple("homeHotThreads",      "Hot threads",      HotThreads);
simple("homePopularTags",     "Popular tags",     PopularTags);
simple("homeSuggestedPeople", "Suggested people", SuggestedPeople);
