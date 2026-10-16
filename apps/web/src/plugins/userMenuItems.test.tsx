// @vitest-environment jsdom
/**
 * Plugin entries in the member's avatar menu: registered, ordered, gone with
 * their plugin, and drawn by the menu itself between Account settings and Sign out.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { faCrown } from "@fortawesome/free-solid-svg-icons";
import { slotRegistry } from "./slotRegistry";

afterEach(() => { slotRegistry.deregister("test-menu"); slotRegistry.deregister("test-menu-2"); });

function register(pluginId: string, id: string, label: string, order?: number) {
  slotRegistry.registerPluginMeta({ pluginId });
  slotRegistry.registerUserMenuItem({ id, label, to: `/${id}`, icon: faCrown, order });
}

describe("user menu items", () => {
  it("are listed by order", () => {
    register("test-menu", "b-item", "Second", 20);
    register("test-menu-2", "a-item", "First", 10);
    expect(slotRegistry.getUserMenuItems().map((i) => i.label)).toEqual(["First", "Second"]);
  });

  it("leave with their plugin", () => {
    register("test-menu", "gone", "Gone");
    slotRegistry.deregister("test-menu");
    expect(slotRegistry.getUserMenuItems().find((i) => i.id === "gone")).toBeUndefined();
  });

  it("render in the avatar menu between Account settings and Sign out", async () => {
    register("test-menu", "membership", "Membership");
    const { UserDropdown } = await import("../layouts/PubNav");
    const user = { id: "u1", username: "rin", avatar: null, visibleGroups: [], groups: [], permissions: [] } as never;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><UserDropdown user={user} /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const items = [...document.querySelectorAll(".pub-nav__dropdown-item")].map((el) => el.textContent?.trim() ?? "");
    const at = (needle: RegExp) => items.findIndex((x) => needle.test(x));
    const account = at(/account|nav\.accountSettings/i);
    const member = at(/^Membership$/);
    const signOut = at(/sign out|nav\.signOut/i);
    expect(member).toBeGreaterThan(account);
    expect(member).toBeLessThan(signOut);
    expect(screen.getByRole("link", { name: "Membership" }).getAttribute("href")).toBe("/membership");
  });
});
