/**
 * The top ACP menu shows add-ons' counts like the side menu does: a dot on the
 * section, the number beside the page (in its dropdown and in the section's tabs).
 * Until then only the site header's gear showed a dot, with nothing in the ACP
 * saying where.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NavItem } from "../useAcpNav";

const { HorizontalNav } = await import("./HorizontalNav");
const { slotRegistry } = await import("../../../plugins/slotRegistry");

afterEach(cleanup);

const NAV: NavItem[] = [
  { label: "Overview", to: "/admin" } as NavItem,
  { key: "store", label: "Store", children: [
    { label: "Overview", to: "/admin/store" },
    { label: "Orders", to: "/admin/store/orders" },
  ] } as NavItem,
];

const draw = (at: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}><HorizontalNav nav={NAV} /></MemoryRouter>
  </QueryClientProvider>,
);

describe("the top ACP menu", () => {
  it("marks the section and counts the page an add-on badges", async () => {
    slotRegistry.registerAcpBadge({ id: "t.hnav-orders", path: "/admin/store/orders", count: async () => 3 });
    const { container } = draw("/admin/store");

    // The section's tab strip (Store is the open section) shows the count beside Orders.
    await waitFor(() => expect(container.querySelector(".hctx__tab .hnav__count")?.textContent).toBe("3"));
    expect(container.querySelector(".hctx__tab .hnav__count")!.closest("a")!.textContent).toContain("Orders");
    expect(container.querySelector(".hnav__item .hnav__dot")).not.toBeNull();

    // And the dropdown carries it too.
    fireEvent.click(screen.getByRole("button", { name: /Store/ }));
    const drop = container.querySelector(".hnav__drop")!;
    expect(drop.querySelector(".hnav__count")?.textContent).toBe("3");
  });
});
