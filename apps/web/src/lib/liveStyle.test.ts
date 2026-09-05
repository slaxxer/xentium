/**
 * @vitest-environment jsdom
 *
 * The stylesheet a client is HOLDING, versus the one the server is announcing.
 *
 * A theme switch is the case that matters: activating a theme applies it live and
 * bumps the style version, so a page opened a moment later can load a cached
 * stylesheet from before the switch. The client used to compare one stream event
 * against the previous one — so it recorded the new version as its own baseline,
 * saw no change, and kept painting the previous theme for as long as the tab was
 * open. These tests pin the comparison to the version of the CSS that is actually
 * injected.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Fetched { url: string; }

const fetched: Fetched[] = [];
/** version → the CSS that response carries, so a test can tell them apart. */
const CSS: Record<number, string> = {
  1: ":root { --c-accent: #2f9e5e; }",
  2: ":root { --c-accent: #ff5c39; }",
  3: ":root { --c-accent: #4f7cff; }",
};

/** What the endpoint answers next — a stale cache hit is just an older version. */
let servedVersion = 1;
/** Absent on a draft response and on an older API. */
let stampVersion = true;

let listener: ((e: MessageEvent) => void) | null = null;

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener(_type: string, fn: (e: MessageEvent) => void) { listener = fn; }
  close() {}
}

/** Push a `version` event, the way the server does on connect and on change. */
function announce(version: number): void {
  listener?.(new MessageEvent("version", { data: String(version) }));
}

function injected(): string {
  return document.getElementById("nodevo-custom-tokens")?.textContent ?? "";
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  fetched.length = 0;
  servedVersion = 1;
  stampVersion = true;
  listener = null;
  document.head.innerHTML = "";
  vi.resetModules();

  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push({ url: String(url) });
    // Captured at call time, so a test can change what the endpoint serves NEXT
    // without changing the response already in flight.
    const version = servedVersion;
    const headers = new Headers();
    if (stampVersion && !String(url).includes("source=draft")) {
      headers.set("X-Style-Version", String(version));
    }
    return { ok: true, headers, text: async () => CSS[version] } as unknown as Response;
  });
});

describe("live style sync", () => {
  it("refetches when the stylesheet it holds is older than the stream's version", async () => {
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    // The page loads a CACHED stylesheet: version 1, while the server is on 2.
    await loadTokenCss();
    expect(injected()).toBe(CSS[1]);

    startStyleSync();
    servedVersion = 2;
    announce(2);           // the connect echo — carrying a version we do not hold
    await settle();

    expect(injected()).toBe(CSS[2]);
    expect(fetched.some((f) => f.url.includes("t="))).toBe(true); // cache-busted
  });

  it("does not refetch when the stylesheet it holds is the announced one", async () => {
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    await loadTokenCss();
    startStyleSync();
    const before = fetched.length;
    announce(1);           // the connect echo for the version already injected
    await settle();

    expect(fetched.length).toBe(before);
  });

  it("still catches a change made while the page is open", async () => {
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    await loadTokenCss();
    startStyleSync();
    announce(1);
    await settle();

    servedVersion = 3;
    announce(3);
    await settle();

    expect(injected()).toBe(CSS[3]);
  });

  it("reconciles when the stream arrives BEFORE the startup load resolves", async () => {
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    startStyleSync();
    announce(2);           // no stylesheet held yet — nothing to compare against
    await settle();

    // …and the load that was already in flight brings back the stale one.
    const load = loadTokenCss();   // issued while the endpoint still serves 1
    servedVersion = 2;
    await load;
    await settle();

    expect(injected()).toBe(CSS[2]);
  });

  it("fetches ONCE for an announced version, even if the answer is still stale", async () => {
    // A cache in front of the API that ignores `no-store` would otherwise put the
    // client in a permanent refetch loop.
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    await loadTokenCss();          // holds 1
    startStyleSync();
    announce(2);                   // …and every response keeps answering 1
    await settle();
    await settle();

    expect(fetched.length).toBe(2); // the startup load, and one attempt
  });

  it("refreshes the DRAFT stylesheet in a preview, never the live one", async () => {
    // A preview must not reconcile itself back to the live theme: its stylesheet is
    // staged, and the stream announces what is published.
    const { loadTokenCss, startStyleSync } = await import("./liveStyle");

    await loadTokenCss({ draft: true });
    startStyleSync();
    announce(2);
    await settle();
    announce(3);           // an actual change, via the unstamped fallback path
    await settle();

    expect(fetched.every((f) => f.url.includes("source=draft"))).toBe(true);
  });
});
