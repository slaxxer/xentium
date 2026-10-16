/**
 * Plugin embeds in the Composer: a plugin tool appears only on the surfaces it lists
 * and only for members who hold its permission; inserting puts the placeholder in
 * the document; and the placeholder HTML is EXACTLY what the server's sanitizer
 * keeps (apps/api/src/shared/sanitize/richText.editor.test.ts pins the other side).
 *
 * @vitest-environment jsdom
 */
import { createRef } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { COMPOSER_DEFAULT_CONFIG } from "@xentium/contracts";
import { Composer, type ComposerHandle } from "./Composer";
import { slotRegistry } from "../../plugins/slotRegistry";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { username: "mara", avatar: null, permissions: ["test.create"] } }),
}));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn().mockResolvedValue(COMPOSER_DEFAULT_CONFIG) } }));

const ID = "3f2c1e0a-1b2c-4d5e-8f90-123456789abc";

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } as DOMRect);
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  slotRegistry.registerPluginMeta({ pluginId: "test-polls" } as never);
  slotRegistry.registerEmbed({ type: "poll", component: ({ id }) => <span data-testid="poll">poll {id}</span> });
  slotRegistry.registerComposerTool({
    id: "test-polls.poll", icon: { prefix: "fas", iconName: "chart-simple", icon: [512, 512, [], "", ""] },
    label: "Poll", surfaces: ["forum.post"], permission: "test.create",
    panel: ({ onInsert }) => <button type="button" onClick={() => onInsert({ type: "poll", id: ID })}>make</button>,
  });
  slotRegistry.registerComposerTool({
    id: "test-polls.secret", icon: { prefix: "fas", iconName: "lock", icon: [512, 512, [], "", ""] },
    label: "Secret", surfaces: ["forum.post"], permission: "test.nobody-has-this",
    panel: () => null,
  });
});
afterEach(() => { cleanup(); slotRegistry.deregister("test-polls"); });

describe("plugin composer tools", () => {
  it("are offered only on a surface they list, and only with the permission", () => {
    const { unmount } = mount(<Composer surface="forum.post" />);
    expect(screen.queryByRole("button", { name: "Poll" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Secret" })).toBeNull();
    unmount();

    mount(<Composer surface="article" />);
    expect(screen.queryByRole("button", { name: "Poll" })).toBeNull();
    cleanup();

    mount(<Composer />);
    expect(screen.queryByRole("button", { name: "Poll" })).toBeNull();
  });

  it("insert the placeholder the sanitizer keeps, drawn by the plugin", async () => {
    const ref = createRef<ComposerHandle>();
    mount(<Composer ref={ref} surface="forum.post" />);
    fireEvent.click(screen.getByRole("button", { name: "Poll" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "make" })); });

    expect(ref.current!.getHTML()).toContain(`<div class="xt-embed" data-xt-embed="poll" data-id="${ID}"></div>`);
    expect(ref.current!.getJSON()?.content?.some((n) => n.type === "xtEmbed" && n.attrs?.id === ID)).toBe(true);
    expect(await screen.findByTestId("poll")).toBeTruthy();
  });

  it("keep a stored placeholder through a load, even where the tool is not offered", () => {
    const ref = createRef<ComposerHandle>();
    const html = `<p>a</p><div class="xt-embed" data-xt-embed="poll" data-id="${ID}"></div>`;
    mount(<Composer ref={ref} initialHtml={html} />);
    expect(ref.current!.getHTML()).toContain(`data-xt-embed="poll" data-id="${ID}"`);
  });
});
