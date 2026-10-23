import { describe, it, expect } from "vitest";
import {
  substitutePlaceholders,
  isSafeUrl,
  renderLinkButton,
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KEYS,
  isEmailTemplateKey,
  isLegacyBody,
  renderEmailBody,
  styleContent,
} from "./email-templates.js";

describe("substitutePlaceholders", () => {
  it("replaces a known placeholder", () => {
    expect(substitutePlaceholders("Hi {{username}}!", { username: "ada" })).toBe("Hi ada!");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(substitutePlaceholders("{{ username }}", { username: "ada" })).toBe("ada");
  });

  it("leaves unknown placeholders untouched so typos are visible in a test send", () => {
    expect(substitutePlaceholders("Hi {{nope}}", { username: "ada" })).toBe("Hi {{nope}}");
  });

  it("substitutes a missing-but-declared value as empty", () => {
    expect(substitutePlaceholders("[{{code}}]", { code: undefined })).toBe("[]");
  });

  // The template is admin-authored and trusted; the VALUES are not. A forum
  // thread titled with markup must not become live HTML in a trusted email.
  it("escapes HTML in substituted values", () => {
    const out = substitutePlaceholders("{{title}}", {
      title: `<a href="http://evil.test">click</a>`,
    });
    expect(out).not.toContain("<a href");
    expect(out).toContain("&lt;a href=");
  });

  it("escapes quotes and ampersands", () => {
    expect(substitutePlaceholders("{{body}}", { body: `a & "b" 'c'` }))
      .toBe("a &amp; &quot;b&quot; &#39;c&#39;");
  });

  it("does not escape host-rendered *_button fragments", () => {
    const btn = `<a href="https://x.test">View</a>`;
    expect(substitutePlaceholders("{{link_button}}", { link_button: btn })).toBe(btn);
  });

  it("blanks a javascript: URI in a *_url placeholder", () => {
    expect(substitutePlaceholders(`<a href="{{reset_url}}">x</a>`, { reset_url: "javascript:alert(1)" }))
      .toBe(`<a href="">x</a>`);
  });

  it("blanks a protocol-relative URL", () => {
    expect(substitutePlaceholders("{{link_url}}", { link_url: "//evil.test/x" })).toBe("");
  });

  it("keeps a legitimate absolute URL", () => {
    expect(substitutePlaceholders("{{reset_url}}", { reset_url: "https://a.test/r?token=1&x=2" }))
      .toBe("https://a.test/r?token=1&amp;x=2");
  });
});

describe("isSafeUrl", () => {
  it.each([
    ["https://a.test", true],
    ["http://a.test", true],
    ["/relative/path", true],
    ["//evil.test", false],
    ["javascript:alert(1)", false],
    ["data:text/html;base64,x", false],
    ["", false],
  ])("%s -> %s", (url, expected) => {
    expect(isSafeUrl(url)).toBe(expected);
  });
});

describe("renderLinkButton", () => {
  it("returns empty markup for a missing or unsafe url", () => {
    expect(renderLinkButton(undefined)).toBe("");
    expect(renderLinkButton("javascript:alert(1)")).toBe("");
  });

  it("renders an anchor for a safe url", () => {
    const html = renderLinkButton("https://a.test/thread/1");
    expect(html).toContain(`href="https://a.test/thread/1"`);
    expect(html).toContain("View →");
  });
});

describe("shipped defaults", () => {
  it("every key has a subject, a body and declared placeholders", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = EMAIL_TEMPLATE_DEFAULTS[key];
      expect(def.subject.length, key).toBeGreaterThan(0);
      expect(def.body.length, key).toBeGreaterThan(0);
      expect(def.placeholders.length, key).toBeGreaterThan(0);
    }
  });

  // A placeholder in the shipped copy that nothing supplies would render as a
  // literal {{...}} in a real email.
  it("only uses placeholders it declares", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = EMAIL_TEMPLATE_DEFAULTS[key];
      const used = [...`${def.subject} ${def.body}`.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)]
        .map(m => (m[1] ?? "").toLowerCase())
        .filter(Boolean);
      for (const name of used) {
        expect(def.placeholders, `${key} uses {{${name}}}`).toContain(name);
      }
    }
  });

  it("recognises only real template keys", () => {
    expect(isEmailTemplateKey("password_reset")).toBe(true);
    expect(isEmailTemplateKey("not_a_template")).toBe(false);
  });
});

describe("renderEmailBody", () => {
  const vars = { site_name: "Acme", reset_url: "https://a.test/r?t=1", code: "123456", title: "<b>x</b>" };

  it("puts editor content inside the frame with the brand line", () => {
    const html = renderEmailBody("<p>Hello</p>", vars);
    expect(html.startsWith("<table ")).toBe(true);
    expect(html).toContain(">Acme</span>");
    expect(html).toContain("Hello</p>");
  });

  it("paints its own page and card, so a dark-mode client can't put dark text on black", () => {
    const html = renderEmailBody("<p>Hello</p>", vars);
    expect(html).toContain(`bgcolor="#f1f1f6"`);
    expect(html).toContain(`bgcolor="#ffffff"`);
    expect(html).toMatch(/color:#0d0d22">Acme<\/span>/);
  });

  it("names the site under the card, linking only a safe address", () => {
    const linked = renderEmailBody("<p>x</p>", { ...vars, site_url: "https://acme.test" });
    expect(linked).toContain(`Acme · <a href="https://acme.test"`);
    expect(linked).toContain(">acme.test</a>");
    const unsafe = renderEmailBody("<p>x</p>", { ...vars, site_url: "javascript:alert(1)" });
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).not.toContain("Acme · <a");
  });

  it("styles the tags the editor writes, keeping their own alignment", () => {
    expect(styleContent("<h2>Hi</h2>")).toMatch(/^<h2 style="font-size:20px/);
    expect(styleContent(`<p style="text-align: center">x</p>`)).toMatch(/style="color:#4a4a7a[^"]*;text-align: center"/);
  });

  it("renders a button placeholder from its url, replacing its paragraph", () => {
    const html = renderEmailBody("<p>{{reset_button}}</p>", vars);
    expect(html).toContain(`href="https://a.test/r?t=1"`);
    expect(html).toContain("Reset password →");
    expect(html).not.toMatch(/<p style="[^"]*"><p/);
  });

  it("renders the code box with an escaped code", () => {
    expect(renderEmailBody("<p>{{code_box}}</p>", vars)).toContain(">123456</span>");
    expect(renderEmailBody("{{code_box}}", { code: "<i>" })).toContain("&lt;i&gt;");
  });

  it("still escapes values in content", () => {
    expect(renderEmailBody("<h2>{{title}}</h2>", vars)).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("sends a body saved as a whole HTML document exactly as written", () => {
    const legacy = `<div style="x"><p>{{site_name}}</p></div>`;
    expect(isLegacyBody(legacy)).toBe(true);
    expect(renderEmailBody(legacy, vars)).toBe(`<div style="x"><p>Acme</p></div>`);
  });

  it("ships no default as a legacy document", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) expect(isLegacyBody(EMAIL_TEMPLATE_DEFAULTS[key].body), key).toBe(false);
  });
});
