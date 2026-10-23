/**
 * The add-on upload component: sends each file to the add-on's route with
 * progress, refuses an oversized file before sending, and shows the server's own
 * message when it refuses.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.size ? `${k}:${o.size}` : k) }) }));
vi.mock("../lib/api", () => ({ api: { tryRefresh: vi.fn(async () => null) } }));
vi.mock("../lib/authStore", () => ({ authStore: { token: "tok" } }));

import { Uploader } from "./Uploader";

interface Sent { url: string; headers: Record<string, string>; body: FormData }
const sent: Sent[] = [];
let reply: { status: number; body: unknown } = { status: 201, body: { ref: "r1" } };

class FakeXhr {
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void;
  status = 0; responseText = ""; withCredentials = false;
  private req: Partial<Sent> = { headers: {} };
  open(_m: string, url: string) { this.req.url = url; }
  setRequestHeader(k: string, v: string) { this.req.headers![k] = v; }
  send(body: FormData) {
    sent.push({ ...(this.req as Sent), body });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    queueMicrotask(() => { this.status = reply.status; this.responseText = JSON.stringify(reply.body); this.onload?.(); });
  }
}

beforeEach(() => { sent.length = 0; reply = { status: 201, body: { ref: "r1" } }; vi.stubGlobal("XMLHttpRequest", FakeXhr); vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const pick = (container: HTMLElement, files: File[]) =>
  fireEvent.change(container.querySelector("input[type=file]")!, { target: { files } });

describe("Uploader", () => {
  it("sends the file and the extra fields to the add-on's route, signed in", async () => {
    const done = vi.fn();
    const { container } = render(<Uploader url="/p/gallery/photos" extra={{ albumId: "a1" }} accept={["image"]} onUploaded={done} />);
    expect(container.querySelector("input")!.getAttribute("accept")).toContain("image/jpeg");
    pick(container, [new File(["x"], "cat.png", { type: "image/png" })]);
    await waitFor(() => expect(done).toHaveBeenCalledWith({ ref: "r1" }, expect.any(File)));
    expect(sent[0]!.url).toBe("/api/p/gallery/photos");
    expect(sent[0]!.headers.Authorization).toBe("Bearer tok");
    expect(sent[0]!.body.get("albumId")).toBe("a1");
    expect((sent[0]!.body.get("file") as File).name).toBe("cat.png");
  });

  it("refuses a file that is too large without sending it", async () => {
    const { container } = render(<Uploader url="/p/x/up" maxBytes={1024 * 1024} />);
    pick(container, [new File([new Uint8Array(2 * 1024 * 1024)], "big.zip")]);
    expect((await screen.findByRole("alert")).textContent).toContain("uploader.tooLarge:1 MB");
    expect(sent).toHaveLength(0);
  });

  it("shows the server's own message when it refuses", async () => {
    reply = { status: 422, body: { error: { message: "This type of file is not allowed here" } } };
    const { container } = render(<Uploader url="/p/x/up" />);
    pick(container, [new File(["x"], "a.exe")]);
    expect((await screen.findByRole("alert")).textContent).toContain("This type of file is not allowed here");
  });
});
