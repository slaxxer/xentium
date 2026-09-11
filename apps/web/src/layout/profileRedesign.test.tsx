/**
 * The profile's redesigned default: the cover, the stat tiles and the rank rail.
 *
 * @vitest-environment jsdom
 *
 * Rendered through the REAL `LayoutRenderer` against the REAL code default, because
 * the thing worth guarding is the pair: a block that renders beautifully but is not
 * in `DEFAULT_LAYOUTS['profile']` ships to nobody, and a default that names a block
 * the registry does not have renders as a gap. `templateAdoption.test.ts` proves
 * every template places SOMETHING; this proves the profile places the redesign.
 *
 * ⚠ It also pins the rail's self-gating. Those blocks sit in the default `aside` of
 * every site, including the many that never configure a ladder — so "draws nothing
 * when there is no progression" is a shipping requirement, not a nicety.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_LAYOUTS } from "@nodevo/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import type { ProfileContext, ProfileProgression } from "../features/profiles/ProfilePage";

// The catalogue, as main.tsx registers it.
import "./blocks/coreBlocks";
import "./blocks/profileBlocks";

const profileDoc = DEFAULT_LAYOUTS.profile!;

const PROFILE = {
  id: "u1", username: "rot", displayName: null, namePreference: "username",
  previousUsernames: [], avatar: null, bio: "Building things.",
  joinedDate: "2026-01-01T00:00:00.000Z",
  groups: [{ id: "g1", name: "Administrator", key: "admin", icon: null, displayOrder: 100,
             badgeColor: "#ff6688", badgeLabel: null }],
  postCount: 3, articleCount: 12, followerCount: 128, followingCount: 43,
  likeCountReceived: 340, isOwn: false, viewerIsFollowing: false,
  viewerHasBlocked: false, isBanned: false, isPermanentBan: false,
} as unknown as ProfileContext["profile"];

const ctx = (over: Partial<ProfileContext> = {}): ProfileContext => ({
  profile: PROFILE,
  isAuthenticated: false,
  tab: "articles",
  setTab: () => {},
  tabs: [{ id: "articles", label: "Articles" }],
  stats: [
    { value: 12,  label: "Articles",  onClick: undefined },
    { value: 340, label: "Likes",     onClick: undefined },
    { value: 128, label: "Followers", onClick: () => {} },
    { value: 43,  label: "Following", onClick: () => {} },
  ],
  infoFields: [],
  progression: null,
  followers: null,
  onFollow: () => {},
  onBlockToggle: () => {},
  followPending: false,
  blockPending: false,
  ...over,
} as ProfileContext);

const RANKED: ProfileProgression = {
  enabled: true,
  showProgressBar: true,
  current: { badgeLabel: "Contributor", badgeColor: "#22aa77", ladderPosition: 2 },
  next:    { badgeLabel: "Veteran",     badgeColor: "#3388ff", ladderPosition: 3 },
  atTop: false,
  percent: 60,
  primary: { label: "articles", have: 12, need: 20, remaining: 8 },
  unlocks: [
    { key: "articleLength", value: 40000 },
    { key: "dailyArticles", value: 6 },
  ],
};

/**
 * ⚠ Wrapped in a QueryClientProvider, because every real render is. Blocks that
 * resolve their own data — badges, visitors, and the rank rail when no host supplies
 * it — call `useQuery`, and `useQuery` needs a client even when it is disabled. A
 * bare `render` here failed with "No QueryClient set" and the BlockBoundary swallowed
 * it into an empty region, which reads as "the block drew nothing" rather than as a
 * crash. The client retries nothing and caches nothing between tests.
 */
const renderRegion = (region: string, context: ProfileContext) =>
  render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })}>
      <LayoutRegion document={profileDoc} region={region} context={context} />
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe("the profile's body", () => {
  it("opens with a cover band", () => {
    renderRegion("main", ctx());
    expect(document.querySelector(".profile-cover")).toBeTruthy();
  });

  it("lifts the avatar over it", () => {
    // The overlap is a PROP, and it only means anything under a cover — so the
    // default has to set it, not just style it.
    renderRegion("main", ctx());
    expect(document.querySelector(".profile-av--overlap")).toBeTruthy();
  });

  it("draws each stat as its own tile", () => {
    renderRegion("main", ctx());
    expect(document.querySelectorAll(".profile-stat").length).toBe(4);
    expect(screen.getByText("340")).toBeTruthy();
  });
});

describe("the rank rail", () => {
  it("draws nothing at all when the site has no progression", () => {
    // The default ships this block to every site, most of which never configure a
    // ladder. An empty card on every profile would be the cost of that.
    const { container } = renderRegion("aside", ctx({ progression: { enabled: false } }));
    expect(container.querySelector(".profile-rank")).toBeNull();
  });

  it("draws nothing while the request is still in flight", () => {
    const { container } = renderRegion("aside", ctx({ progression: null }));
    expect(container.querySelector(".profile-rank")).toBeNull();
  });

  it("shows the current and next rung, and how far there is to go", () => {
    renderRegion("aside", ctx({ progression: RANKED }));
    const chips = [...document.querySelectorAll(".profile-rank__chip")].map((c) => c.textContent);
    expect(chips).toEqual(["Contributor", "Veteran"]);
    expect(screen.getByText("60%")).toBeTruthy();
  });

  it("fills the bar to the percentage the server computed", () => {
    renderRegion("aside", ctx({ progression: RANKED }));
    const fill = document.querySelector(".profile-rank__bar span") as HTMLElement;
    expect(fill.style.width).toBe("60%");
  });

  it("honours the admin's switch for the bar, keeping the rest", () => {
    // `progression.show_progress_bar` is a real setting: a site can rank people
    // without racing them.
    renderRegion("aside", ctx({ progression: { ...RANKED, showProgressBar: false } }));
    expect(document.querySelector(".profile-rank__bar")).toBeNull();
    expect(document.querySelector(".profile-rank__chip")?.textContent).toBe("Contributor");
  });

  it("lists what the next rung unlocks", () => {
    renderRegion("aside", ctx({ progression: RANKED }));
    expect(document.querySelectorAll(".profile-rank__unlocks li").length).toBe(2);
  });

  it("says nothing about unlocks at the top of the ladder", () => {
    // There is no next rung to describe, and "unlocks nothing" is not a message.
    renderRegion("aside", ctx({ progression: { ...RANKED, atTop: true, next: null, unlocks: [] } }));
    expect(document.querySelector(".profile-rank__unlocks")).toBeNull();
  });

});

describe("the followers strip", () => {
  it("stays away until there is someone to show", () => {
    renderRegion("aside", ctx({ progression: RANKED, followers: { items: [], total: 0 } }));
    expect(document.querySelector(".profile-strip")).toBeNull();
  });

  it("counts from the PROFILE, not from the handful of avatars it drew", () => {
    // The strip is five faces; the number is how many there really are.
    renderRegion("aside", ctx({
      progression: RANKED,
      followers: { items: [
        { id: "a", username: "ann", avatar: null },
        { id: "b", username: "bob", avatar: null },
      ], total: 2 },
    }));
    expect(document.querySelectorAll(".profile-strip__av").length).toBe(2);
    expect(screen.getByText("128")).toBeTruthy();
  });
});
