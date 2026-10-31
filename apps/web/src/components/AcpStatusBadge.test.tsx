/**
 * The gear's dot: core's own reasons (updates, licence, announcement) and any
 * add-on's ACP badge (e.g. the store's orders waiting for a payment check).
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const summary = { total: 0 };
vi.mock("../lib/api", () => ({ api: { get: vi.fn(async () => summary) } }));

const { AcpStatusBadge } = await import("./AcpStatusBadge");
const { slotRegistry } = await import("../plugins/slotRegistry");

afterEach(cleanup);

const draw = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AcpStatusBadge />
  </QueryClientProvider>,
);

describe("the ACP gear's dot", () => {
  it("stays off when neither core nor an add-on has anything waiting", async () => {
    const { container } = draw();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector(".pub-nav__dot")).toBeNull();
  });

  it("lights up for an add-on's ACP badge", async () => {
    slotRegistry.registerAcpBadge({ id: "t.orders", path: "/admin/t/orders", count: async () => 2 });
    const { findByRole } = draw();
    expect(await findByRole("status")).not.toBeNull();
  });
});
