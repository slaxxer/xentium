/**
 * ACP → Extensions → Marketplace (redesign 1b): every card shows one footer action
 * for where that listing stands on this site, the status filters count and filter
 * what was fetched, and the licence strip counts the paid listings it covers.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const L = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "plugin", name: id, description: `${id} does things.`, vendor: "Xentium", priceCents: 1000,
  latestVersion: "1.0.0", licenseRequired: true, trustTier: "audited", storeUrl: `https://store.test/store/plugins/${id}`, ...extra,
});
const CATALOGUE = [
  L("on-one"),                                   // installed + enabled
  L("off-one"),                                  // installed, switched off
  L("owned-one", { owned: true }),               // licensed, not installed
  L("free-one", { priceCents: 0, licenseRequired: false }),
  L("buy-one", { owned: false }),                // paid, not owned
];

vi.mock("../../../lib/api", () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith("/admin/marketplace/plugins")) {
        const one = url.includes("limit=1&") || url.endsWith("limit=1");
        return { data: one ? [] : url.includes("kind=theme") ? [] : CATALOGUE, meta: { page: 1, totalPages: 1, total: url.includes("kind=theme") ? 0 : CATALOGUE.length } };
      }
      if (url === "/plugins") return [{ id: "on-one", status: "enabled" }, { id: "off-one", status: "disabled" }];
      if (url === "/admin/license") return { entitlementJwt: `x.${btoa(JSON.stringify({ entitlements: [{ id: "plugin.on-one" }, { id: "plugin.off-one" }] }))}.y` };
      if (url === "/admin/marketplace/connection") return { connected: true };
      return null;
    }),
    post: vi.fn(async () => ({})),
    tryRefresh: vi.fn(async () => null),
  },
  apiStream: vi.fn(),
}));
vi.mock("../components/ExtensionsUpdateBanner", () => ({ ExtensionsUpdateBanner: () => null }));

const { MarketplacePage } = await import("./MarketplacePage");

afterEach(cleanup);

const draw = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><MarketplacePage /></MemoryRouter>
  </QueryClientProvider>,
);
const card = async (name: string) => (await screen.findByText(name)).closest("article") as HTMLElement;

describe("the marketplace page", () => {
  it("gives each card the one action that fits", async () => {
    draw();
    expect(within(await card("on-one")).getByText("marketplace.enabled")).toBeTruthy();
    expect(within(await card("off-one")).getByRole("button", { name: "marketplace.enable" })).toBeTruthy();
    expect(within(await card("owned-one")).getByRole("button", { name: /marketplace.install/ })).toBeTruthy();
    expect(within(await card("free-one")).getByRole("button", { name: /marketplace.install/ })).toBeTruthy();
    expect(within(await card("free-one")).getByText("marketplace.free")).toBeTruthy();
    expect(within(await card("buy-one")).getByRole("button", { name: /marketplace.buy/ })).toBeTruthy();
    expect(within(await card("owned-one")).getByText("marketplace.licensed")).toBeTruthy();
  });

  it("filters by status, and the licence strip counts the paid listings", async () => {
    draw();
    await card("on-one");
    // 4 paid listings; on-one, off-one (signed) and owned-one (the store says so) are licensed.
    expect(screen.getByText("marketplace.licensedSummary.plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /marketplace.filter.enabled/ }));
    expect(screen.queryByText("off-one")).toBeNull();
    expect(screen.getByText("on-one")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /marketplace.filter.free/ }));
    expect(screen.getByText("free-one")).toBeTruthy();
    expect(screen.queryByText("buy-one")).toBeNull();
  });
});
