// @vitest-environment jsdom
/**
 * The default logo: two marks on one page must not share a gradient id (the second
 * would paint with the first's, and vanish if the first unmounts), and the small
 * size uses the favicon geometry so the glyph stays legible.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { XentiumMark } from "./XentiumMark";

describe("XentiumMark", () => {
  it("gives every mark its own gradient", () => {
    const { container } = render(<><XentiumMark size={64} /><XentiumMark size={64} /></>);
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    for (const rect of container.querySelectorAll("rect")) {
      expect(ids).toContain(rect.getAttribute("fill")!.replace(/^url\(#|\)$/g, ""));
    }
  });

  it("uses the tighter favicon geometry at small sizes", () => {
    const small = render(<XentiumMark size={24} />).container.querySelector("rect")!;
    const large = render(<XentiumMark size={96} />).container.querySelector("rect")!;
    expect(small.getAttribute("rx")).toBe("25");
    expect(large.getAttribute("rx")).toBe("30");
  });

  it("is decorative unless titled", () => {
    const { container } = render(<><XentiumMark /><XentiumMark title="Xentium" /></>);
    const [a, b] = [...container.querySelectorAll("svg")];
    expect(a!.getAttribute("aria-hidden")).toBe("true");
    expect(b!.getAttribute("aria-label")).toBe("Xentium");
  });

  it("keeps Xentium's own colours where asked (the ACP, the installer)", () => {
    const { container } = render(<><XentiumMark /><XentiumMark brand /></>);
    const [site, brand] = [...container.querySelectorAll("svg")];
    expect(site!.classList.contains("xt-mark--brand")).toBe(false);
    expect(brand!.classList.contains("xt-mark--brand")).toBe(true);
  });
});
