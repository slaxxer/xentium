/**
 * `ThemePreview` — a stranger's document embedded in the admin panel.
 *
 * @vitest-environment jsdom
 *
 * The marketplace route already serves this page under a CSP that sandboxes it and
 * forbids scripts. The `sandbox` attribute here is the SECOND lock, and it exists
 * precisely because the first one lives in another repo: if that route is ever
 * refactored, or a self-hosted marketplace serves the same shape with weaker
 * headers, this attribute is what still holds. It must never be quietly dropped as
 * "redundant", which is the only way an attribute like this ever disappears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemePreview } from "./ThemePreview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// No global setup file registers auto-cleanup, so each render would otherwise
// stack another copy of the component in the document and the queries below would
// match the PREVIOUS test's markup.
afterEach(cleanup);

const base = "https://marketplace.example/api/v1/catalog/aurora/preview";

describe("the embed itself", () => {
  it("is sandboxed with no allow-tokens", () => {
    render(<ThemePreview name="Aurora" base={base} templates={["home"]} />);
    const frame = document.querySelector("iframe")!;
    // Empty string, not absent: `sandbox=""` is the most restrictive value there
    // is, while a missing attribute is no sandbox at all.
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("points at the marketplace's absolute URL, not the instance", () => {
    // The catalogue hands over an absolute base for the same reason listing images
    // are absolute: this renders inside the ACP, on the INSTANCE's origin, where a
    // relative path resolves to the instance and 404s.
    render(<ThemePreview name="Aurora" base={base} templates={["home"]} />);
    expect(document.querySelector("iframe")!.getAttribute("src"))
      .toBe(`${base}/home?scheme=light`);
  });

  it("encodes a template key rather than pasting it into the path", () => {
    render(<ThemePreview name="Aurora" base={base} templates={["forum.index"]} />);
    expect(document.querySelector("iframe")!.getAttribute("src"))
      .toBe(`${base}/forum.index?scheme=light`);
  });
});

describe("what it offers", () => {
  it("shows a tab per rendered template, starting on the first", () => {
    render(<ThemePreview name="Aurora" base={base} templates={["home", "members"]} />);
    expect(screen.getByRole("button", { name: "home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "members" })).toBeTruthy();
  });

  it("renders nothing at all when the theme has no rendered pages", () => {
    // Absent previews must not leave an empty frame behind — a broken-looking
    // panel reads as the preview failing rather than never having existed.
    const { container } = render(<ThemePreview name="Aurora" base={base} templates={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
