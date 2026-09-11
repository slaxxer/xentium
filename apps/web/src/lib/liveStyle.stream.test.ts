/**
 * The style stream's lifecycle.
 *
 * @vitest-environment jsdom
 *
 * ⚠ This exists because a LEAKED stream is not a slow leak — it is a hard stop. Each
 * one that lingers costs a connection from the browser's per-origin budget, and at
 * six the origin stops answering that page at all: every request queues forever and
 * the page looks frozen. That is what the layout editor was doing.
 *
 * ⚠ ONE test walking the whole lifecycle, deliberately, with ONE module instance.
 * Split across cases with `vi.resetModules()`, every case registers its own
 * `pagehide`/`pageshow` listeners on the SAME jsdom window; the earlier modules then
 * react to later tests' events and open streams of their own. The app has exactly one
 * module instance, so a test with several is testing a situation that cannot occur.
 */
import { describe, it, expect, beforeAll } from "vitest";

class FakeSource {
  static all: FakeSource[] = [];
  closed = false;
  constructor(public url: string) { FakeSource.all.push(this); }
  addEventListener() {}
  close() { this.closed = true; }
}

const hide = (persisted: boolean) =>
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
const show = (persisted: boolean) =>
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));

let startStyleSync: () => void;

beforeAll(async () => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeSource;
  ({ startStyleSync } = await import("./liveStyle"));
});

describe("the style stream", () => {
  it("opens one connection, closes it with the document, and comes back with it", () => {
    // Idempotent: several mount points, one connection.
    startStyleSync();
    startStyleSync();
    startStyleSync();
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]!.closed).toBe(false);

    // ⚠ The leak this fixes: without an explicit close the stream outlives the page.
    hide(true);
    expect(FakeSource.all[0]!.closed).toBe(true);

    // Restored from bfcache — a page that comes back must not come back mute.
    show(true);
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[1]!.closed).toBe(false);

    // An ordinary navigation away is not a restore; nothing reopens.
    hide(false);
    expect(FakeSource.all[1]!.closed).toBe(true);
    show(false);
    expect(FakeSource.all).toHaveLength(2);
  });
});
