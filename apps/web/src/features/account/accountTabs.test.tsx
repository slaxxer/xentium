// @vitest-environment jsdom
/**
 * Plugin tabs on the member's Account page (`registerAccountTab`): listed after
 * core's tabs under their group heading, opened at `/account?tab=<id>`, hidden from
 * members without their permission, and found by the account menu's search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { faKey } from "@fortawesome/free-solid-svg-icons";
import { slotRegistry } from "../../plugins/slotRegistry";
import { authStore } from "../../lib/authStore";
import { AccountPage } from "./AccountPage";

function Licences() { return <p>licence list</p>; }

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ inApp: {}, email: {} }), { status: 200, headers: { "content-type": "application/json" } })));
  slotRegistry.registerPluginMeta({ pluginId: "test-shop" });
  slotRegistry.registerAccountTab({ id: "test-shop.licences", label: "Licences", group: "Shop", icon: faKey, component: Licences, keywords: "keys seats" });
  slotRegistry.registerAccountTab({ id: "test-shop.payouts", label: "Payouts", group: "Shop", permission: "test-shop.publish", component: () => <p>payouts</p> });
});
// Unmount BEFORE signing out: a mounted Account page redirects a signed-out visitor,
// and with nothing to route to that redirect repeats forever.
afterEach(() => { cleanup(); slotRegistry.deregister("test-shop"); authStore.clear(); vi.unstubAllGlobals(); });

function signIn(permissions: string[]) {
  authStore.set("token", {
    id: "u1", username: "rin", email: "rin@example.test", displayName: null, avatar: null, bio: null,
    postCount: 0, articleCount: 0, followerCount: 0, followingCount: 0, createdAt: "", loginPinEnabled: false,
    dobDisplay: "hidden", preferredLocale: null, likeCountReceived: 0, groups: [], hiddenBadges: [], visibleGroups: [],
    permissions,
  });
}

const page = (url: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}><AccountPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe("plugin account tabs", () => {
  it("are listed under their group, and open their page from the URL", () => {
    signIn([]);
    page("/account?tab=test-shop.licences");
    expect(screen.getByText("Shop")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Licences" }).className).toContain("is-on");
    expect(screen.getByText("licence list")).toBeTruthy();
  });

  it("are hidden from members without their permission", () => {
    signIn([]);
    page("/account?tab=test-shop.licences");
    expect(screen.queryByRole("button", { name: "Payouts" })).toBeNull();
    cleanup();
    signIn(["test-shop.publish"]);
    page("/account?tab=test-shop.payouts");
    expect(screen.getByText("payouts")).toBeTruthy();
  });

  it("are found by the menu's search through their keywords", () => {
    signIn([]);
    page("/account?tab=test-shop.licences");
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "seats" } });
    expect(screen.getByRole("button", { name: "Licences" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /profile/i })).toBeNull();
  });
});
