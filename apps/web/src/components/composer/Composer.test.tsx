/**
 * The Composer's three presentations, and the rules that differ between them.
 *
 * @vitest-environment jsdom
 *
 * ⚠ The `dock` variant is tested here rather than in a browser because the surface
 * that asks for it — the messaging plugin's conversation view — reaches it only
 * through a rebuilt bundle. The variant is code either way, and these are its rules.
 */
import { createRef } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { COMPOSER_DEFAULT_CONFIG } from "@xentium/contracts";
import { Composer, type ComposerHandle } from "./Composer";

/** i18n is not initialised in a unit test — `t()` returns the key, which is fine:
 *  every assertion below is about STRUCTURE, not copy. */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { username: "mara", avatar: null } }),
}));

/** The config endpoint, answered from the shipped default. */
vi.mock("../../lib/api", () => ({
  api: { get: vi.fn().mockResolvedValue(COMPOSER_DEFAULT_CONFIG) },
}));

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  // TipTap measures; jsdom does not implement these.
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } as DOMRect);
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});
afterEach(cleanup);

describe("the inline variant", () => {
  /** ⚠ The point of `inline`: it is not an editor until someone means to write. */
  it("starts as one row and opens on click", () => {
    const { container } = mount(<Composer variant="inline" placeholder="say something" />);

    expect(container.querySelector(".nvc--collapsed")).toBeTruthy();
    expect(container.querySelector(".nvc-bar")).toBeNull();

    fireEvent.click(container.querySelector(".nvc--collapsed")!);

    expect(container.querySelector(".nvc--collapsed")).toBeNull();
    expect(container.querySelector(".nvc-bar")).toBeTruthy();
  });

  /**
   * ⚠ The collapsed row is NOT also `.nvc`. That class is the open shell and sets
   * `flex-direction: column`, which stood the row on its end the first time.
   */
  it("does not wear the open shell's class while collapsed", () => {
    const { container } = mount(<Composer variant="inline" />);
    const row = container.querySelector(".nvc--collapsed")!;
    expect(row.classList.contains("nvc")).toBe(false);
  });

  it("re-collapses when the caller clears it after a post", () => {
    const ref = createRef<ComposerHandle>();
    const { container } = mount(<Composer ref={ref} variant="inline" />);
    fireEvent.click(container.querySelector(".nvc--collapsed")!);
    expect(container.querySelector(".nvc-bar")).toBeTruthy();

    // ⚠ `act`: `clear()` is called from outside React, as a caller does after a
    // successful post, and the collapse is a state update that has to flush.
    act(() => ref.current!.clear());
    expect(container.querySelector(".nvc--collapsed")).toBeTruthy();
  });
});

describe("the dock variant", () => {
  it("hides formatting behind Aa, and shows it when pressed", async () => {
    const { container } = mount(<Composer variant="dock" onSubmit={() => {}} />);
    // The config has to land before the bar can have tools.
    await screen.findByTitle("composer.formatting");

    expect(container.querySelector(".nvc-bar__aa")).toBeTruthy();
    expect(container.querySelectorAll(".nvc-bar__tool").length).toBe(0);

    fireEvent.click(container.querySelector(".nvc-bar__aa")!);
    expect(container.querySelectorAll(".nvc-bar__tool").length).toBeGreaterThan(0);
  });

  /** Chat sends with an icon, not a word — and never grows a block picker. */
  it("uses a send button and no block picker", async () => {
    const { container } = mount(<Composer variant="dock" onSubmit={() => {}} />);
    await screen.findByTitle("composer.formatting");

    expect(container.querySelector(".nvc-send")).toBeTruthy();
    expect(container.querySelector(".nvc-btn--primary")).toBeNull();
    expect(container.querySelector(".nvc-bar__block")).toBeNull();
  });
});

describe("the panel variant", () => {
  it("is open from the start and offers the block picker", async () => {
    const { container } = mount(<Composer variant="panel" />);
    await screen.findByText("composer.block.paragraph");

    expect(container.querySelector(".nvc--collapsed")).toBeNull();
    expect(container.querySelector(".nvc-bar__block")).toBeTruthy();
  });

  /**
   * ⚠ `submitInBar={false}` is what keeps a page from growing TWO post buttons:
   * every existing caller draws its own outside the editor.
   */
  it("draws no primary button when the caller owns one", async () => {
    const { container } = mount(<Composer onSubmit={() => {}} submitInBar={false} />);
    await screen.findByText("composer.block.paragraph");
    expect(container.querySelector(".nvc-btn--primary")).toBeNull();
  });

  it("draws one when it owns the action", async () => {
    const { container } = mount(<Composer onSubmit={() => {}} />);
    await screen.findByText("composer.block.paragraph");
    expect(container.querySelector(".nvc-btn--primary")).toBeTruthy();
  });
});

describe("the reply strip", () => {
  /** ⚠ Quote as CONTEXT, never as markup pasted into the body the member owns. */
  it("shows who is being replied to without touching the document", async () => {
    const onDismiss = vi.fn();
    const { container } = mount(
      <Composer replyTo={{ name: "maria", excerpt: "do counters get recomputed" }} onDismissReply={onDismiss} />,
    );
    const strip = container.querySelector(".nvc-reply")!;
    expect(strip.textContent).toContain("maria");
    expect(container.querySelector(".nvc-content")!.textContent).toBe("");

    fireEvent.click(container.querySelector(".nvc-reply__x")!);
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("the paperclip", () => {
  /** A surface with no upload path gets a disabled button and the reason. */
  it("is disabled, with a reason, when the surface cannot attach", async () => {
    mount(<Composer canAttach={false} />);
    const attach = await screen.findByTitle("composer.attachUnavailable");
    expect((attach as HTMLButtonElement).disabled).toBe(true);
  });

  it("is live when the caller provides somewhere to put a file", async () => {
    const onAttach = vi.fn();
    mount(<Composer canAttach onAttach={onAttach} />);
    const attach = await screen.findByLabelText("composer.tool.attach");
    expect((attach as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(attach);
    expect(onAttach).toHaveBeenCalled();
  });
});

/**
 * A surface that stores ProseMirror JSON (articles). The document must go in and come
 * out as JSON, never through HTML, and the reader's extension set has no mention node.
 */
describe("a JSON surface", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello there" }] }] };

  it("loads the document it is given and hands it back as JSON", async () => {
    const ref = createRef<ComposerHandle>();
    mount(<Composer ref={ref} initialJson={doc} mentions={false} />);
    await screen.findByText("Hello there");
    // The editor normalises (a paragraph gains `attrs`), so compare what it SAYS.
    const out = ref.current?.getJSON();
    expect(out?.type).toBe("doc");
    expect(out?.content?.[0]?.content?.[0]?.text).toBe("Hello there");
  });

  it("follows a replaced document, and leaves the same one alone", async () => {
    const onChangeJson = vi.fn();
    const { rerender } = mount(<Composer initialJson={doc} onChangeJson={onChangeJson} mentions={false} />);
    await screen.findByText("Hello there");
    // Mounting is not an edit either.
    expect(onChangeJson).not.toHaveBeenCalled();

    const next = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Restored draft" }] }] };
    const qc = new QueryClient();
    await act(async () => {
      rerender(<QueryClientProvider client={qc}><Composer initialJson={next} onChangeJson={onChangeJson} mentions={false} /></QueryClientProvider>);
    });
    await screen.findByText("Restored draft");
    // Loading a document is not an edit: nothing is reported back to the caller.
    expect(onChangeJson).not.toHaveBeenCalled();
  });

  it("offers no mention tool when mentions are off", async () => {
    mount(<Composer mentions={false} />);
    await screen.findByLabelText("composer.tool.bold");
    expect(screen.queryByLabelText("composer.tool.mention")).toBeNull();
    expect(screen.queryByText("composer.hintMention")).toBeNull();
  });
});
