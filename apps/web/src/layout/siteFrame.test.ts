import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_FRAME, siteFrameSchema } from "@xentium/contracts";
import { presentFrame } from "./siteFrame";

describe("presentFrame", () => {
  it("full width adds no box and no properties — the page renders as it always did", () => {
    const p = presentFrame({ ...DEFAULT_SITE_FRAME, mode: "full" }, "home");
    expect(p.className).toBe("app-layout app-layout--frame-full");
    expect(p.style).toEqual({});
  });

  it("a boxed frame names its mode, phone rule and values", () => {
    const f = siteFrameSchema.parse({ mode: "boxed", radius: 7, maxWidth: 1100, shadow: "lifted", phone: "keep" });
    const p = presentFrame(f, "members");
    expect(p.className.split(" ")).toEqual(expect.arrayContaining([
      "app-layout--frame-boxed", "app-layout--boxed", "app-layout--phone-keep", "app-layout--bg-fixed",
    ]));
    expect(p.style).toMatchObject({
      "--frame-max": "1100px", "--frame-r": "7px", "--frame-shadow": "var(--frame-shadow-lifted)",
    });
  });

  it("follows the page's own frame", () => {
    const f = siteFrameSchema.parse({ mode: "boxed", overrides: { home: "full" } });
    expect(presentFrame(f, "home").mode).toBe("full");
    expect(presentFrame(f, "profile").mode).toBe("boxed");
  });

  it("an image background resolves the upload path to a URL", () => {
    const f = siteFrameSchema.parse({ mode: "framed", background: { type: "image", image: "layouts/sky.png" } });
    expect((presentFrame(f, null).style as Record<string, string>)["--frame-bg"]).toContain('url("/uploads/layouts/sky.png")');
  });
});

/**
 * ⚠ The frame wrappers sit between the navbar and the page. A wrapper with a box traps
 * a sticky navbar inside it (see the `.pub-head` test in classContract), so at full
 * width all four MUST dissolve. jsdom does no layout, so this asserts the rule.
 */
it("every frame wrapper is display: contents unless a mode gives it a box", () => {
  const scss = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../layouts/AppLayout.scss"),
    "utf8",
  );
  expect(scss).toMatch(/\.app-frame,\s*\.app-frame__body,\s*\.app-frame__box,\s*\.app-frame__foot\s*\{\s*display:\s*contents;/);
  expect(scss).toMatch(/\.app-frame__foot > \.xt-region--footer\s*\{\s*display:\s*contents;/);
});
