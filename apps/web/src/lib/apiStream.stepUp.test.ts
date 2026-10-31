/**
 * Streamed admin jobs (installs and updates from the store) ask for the
 * authenticator code like every other request. Before, the 403 asking for one
 * reached the progress dialog as "http_403".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const asked: Array<string | null> = [];
let answers: Array<string | null> = [];
vi.mock("./stepUp", () => ({
  requestStepUpCode: async (why: string | null) => { asked.push(why); return answers.shift() ?? null; },
}));

const { apiStream } = await import("./api");

const refuse = (code: string) => new Response(JSON.stringify({ error: { code, message: "Confirm with a code." } }), { status: 403 });
const stream = () => new Response('{"done":true,"ok":true}\n', { status: 200 });

afterEach(() => { asked.length = 0; answers = []; vi.unstubAllGlobals(); });

describe("a streamed request that wants a fresh code", () => {
  it("asks for it and sends the request again with it", async () => {
    const sent: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const otp = (init.headers as Record<string, string>)["X-Xentium-OTP"] ?? null;
      sent.push(otp);
      return otp === "123456" ? stream() : refuse("XEC-AUTH-1075");
    }));
    answers = ["123456"];
    const res = await apiStream("/admin/marketplace/install", { pluginId: "x" });
    expect(res.status).toBe(200);
    expect(sent).toEqual([null, "123456"]);
    expect(asked).toEqual([null]);
  });

  it("asks again after a wrong code, and gives up when the prompt is dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>)["X-Xentium-OTP"] ? refuse("XEC-AUTH-1070") : refuse("XEC-AUTH-1075")));
    answers = ["000000", null];
    const res = await apiStream("/admin/marketplace/install", {});
    expect(res.status).toBe(403);
    expect(asked).toEqual([null, "XEC-AUTH-1070"]);
  });

  it("does not ask for any other refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => refuse("XEC-API-4003")));
    expect((await apiStream("/admin/marketplace/install", {})).status).toBe(403);
    expect(asked).toEqual([]);
  });
});
