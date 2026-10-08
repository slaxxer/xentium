/**
 * The moderation tool is its own header block, and the bell no longer carries it —
 * except for a document that does not place one yet, which keeps the shield beside the
 * bell so no saved header or shipped theme loses it.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlockNode, LayoutDocument } from "@xentium/contracts";

vi.mock("../layouts/PubNav", async (orig) => ({
  ...(await orig<typeof import("../layouts/PubNav")>()),
  NavNotifications: ({ withModTool }: { withModTool?: boolean }) =>
    <>{withModTool && <i className="t-shield" />}<i className="t-bell" /></>,
  NavModTool: () => <i className="t-shield" />,
}));

const { LayoutRegion } = await import("./LayoutRenderer");
await import("./blocks/chromeBlocks");

afterEach(cleanup);

const leaf = (id: string, type: string): BlockNode => ({ id, type, props: {} });
const draw = (children: BlockNode[]) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <LayoutRegion region="header" document={{
        templateKey: "chrome.header", schemaVersion: 1,
        regions: { header: [{ id: "h", type: "header", props: {}, children }] },
      } as LayoutDocument} />
    </MemoryRouter>
  </QueryClientProvider>,
);

describe("the moderation tool block", () => {
  it("renders on its own, and the bell is then the bell alone", () => {
    const { container } = draw([leaf("m", "modTool"), leaf("b", "notifications")]);
    expect(container.querySelectorAll(".t-shield")).toHaveLength(1);
    expect(container.querySelector(".xt-b--modTool .t-shield")).not.toBeNull();
    expect(container.querySelector(".xt-b--notifications .t-shield")).toBeNull();
  });

  it("is still drawn beside the bell for a header that does not place it", () => {
    const { container } = draw([leaf("b", "notifications")]);
    expect(container.querySelectorAll(".t-shield")).toHaveLength(1);
    expect(container.querySelector(".xt-b--notifications .t-shield")).not.toBeNull();
  });
});
