/**
 * The FORMAT controls the layout editor draws from a block's schema: "image" gets a
 * thumbnail + Upload, "richtext" gets the Composer. The schemas go through
 * `z.toJSONSchema` exactly as `LayoutEditorPage.schemaFor` does, so a `.meta` key
 * lost in that conversion fails here rather than silently showing a bare input.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { COMPOSER_DEFAULT_CONFIG, blockPropSchemas } from "@xentium/contracts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../lib/coreText", () => ({
  hostText: (_k: string, fallback: string) => fallback,
}));
vi.mock("../lib/swal", () => ({ apiErrorMessage: (e: unknown) => String(e) }));
vi.mock("../lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { username: "mara", avatar: null } }),
}));
const post = vi.fn();
vi.mock("../lib/api", () => ({
  api: { get: vi.fn().mockResolvedValue(COMPOSER_DEFAULT_CONFIG), post: (...a: unknown[]) => post(...a) },
}));

const { SchemaFields } = await import("./SchemaFields");
type FieldSchema = Parameters<typeof SchemaFields>[0]["schema"];

const schemaOf = (s: z.ZodType) => z.toJSONSchema(s as never, { io: "input" }) as FieldSchema;

function mount(schema: FieldSchema, values: Record<string, unknown>, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SchemaFields schema={schema} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

beforeEach(() => {
  // TipTap measures; jsdom does not implement these.
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } as DOMRect);
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  post.mockReset();
});
afterEach(cleanup);

describe("format: image", () => {
  it("survives toJSONSchema on the image block", () => {
    expect(schemaOf(blockPropSchemas.image)?.properties?.source).toMatchObject({ format: "image" });
  });

  it("shows the set image and stores the uploaded PATH, not a URL", async () => {
    post.mockResolvedValue({ path: "layouts/abc.png" });
    const { container, onChange } = mount(schemaOf(blockPropSchemas.image), { source: "articles/1/x.png", ratio: "auto" });

    expect(container.querySelector<HTMLImageElement>(".sf-image__thumb")?.getAttribute("src")).toBe("/uploads/articles/1/x.png");

    const file = new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" });
    fireEvent.change(container.querySelector<HTMLInputElement>('.sf-image input[type="file"]')!, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/admin/layouts/images", expect.any(FormData));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ source: "layouts/abc.png" });
  });

  it("has no thumbnail while nothing is set", () => {
    const { container } = mount(schemaOf(blockPropSchemas.image), { source: "", ratio: "auto" });
    expect(container.querySelector(".sf-image")).toBeTruthy();
    expect(container.querySelector(".sf-image__thumb")).toBeNull();
  });
});

describe("format: richtext", () => {
  it("survives toJSONSchema on a prop with no JSON type", () => {
    expect(schemaOf(blockPropSchemas.richText)?.properties?.content).toMatchObject({ format: "richtext" });
  });

  it("draws the Composer with the stored document", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello layout" }] }] };
    const { container } = mount(schemaOf(blockPropSchemas.richText), { content: doc });

    expect(container.querySelector(".sf-richtext")).toBeTruthy();
    await waitFor(() => expect(container.querySelector(".sf-richtext .ProseMirror")?.textContent).toContain("Hello layout"));
  });
});
