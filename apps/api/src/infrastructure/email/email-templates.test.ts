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
  emailIconUrl,
  emailImageUrl,
  normalizeEmailDesign,
  supportHref,
  requestVars,
  inkOn,
  EMAIL_DESIGN_DEFAULTS,
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
    expect(html).toMatch(/>Acme<\/td>/);
    expect(html).toContain("Hello</p>");
  });

  it("moves an opening heading into the band, and nothing else", () => {
    const html = renderEmailBody("<h1>Back in</h1><p>Hello</p><h2>Later</h2>", vars);
    expect(html).toMatch(/font-size:28px;line-height:34px;font-weight:700;color:#ffffff">Back in<\/td>/);
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h2 style="[^"]*">Later<\/h2>/);
    expect(renderEmailBody("<p>Hello</p><h1>Late</h1>", vars)).toMatch(/<h1 style="[^"]*">Late<\/h1>/);
  });

  it("shows the first line as the inbox preview, without placeholders", () => {
    const html = renderEmailBody("<h1>Hi</h1><p>Someone asked {{username}}. {{reset_button}}</p>", { ...vars, username: "ann" });
    expect(html).toMatch(/^<style>[^<]*<\/style><div style="display:none/);
    expect(html).toContain(">Someone asked ann.</div>");
  });

  it("sets what follows the first line in small print, without the line", () => {
    const html = renderEmailBody("<p>Main</p><hr><p>Not you?</p>", vars);
    expect(html).toContain(`<p style="color:#6b7370;margin:0 0 8px;line-height:20px;font-size:13px">Not you?</p>`);
    expect(html).not.toContain("<hr");
  });

  it("paints its own page and card, so a dark-mode client can't put dark text on black", () => {
    const html = renderEmailBody("<p>Hello</p>", vars);
    expect(html).toContain(`bgcolor="#eef1ef"`);
    expect(html).toContain(`bgcolor="#ffffff"`);
    expect(html).toContain(`bgcolor="#14796b"`);
    expect(html).toMatch(/color:#ffffff">Acme<\/td>/);
  });

  it("shows the site icon beside the name, and no image without a safe address", () => {
    const withIcon = renderEmailBody("<p>x</p>", { ...vars, site_icon_url: "https://acme.test/brand/icon-192.png" });
    expect(withIcon).toContain(`<img src="https://acme.test/brand/icon-192.png" width="30" height="30" alt=""`);
    expect(renderEmailBody("<p>x</p>", vars)).not.toContain("<img");
    expect(renderEmailBody("<p>x</p>", { ...vars, site_icon_url: "javascript:x" })).not.toContain("<img");
  });

  it("picks an icon mail clients can show, on the site's own address", () => {
    expect(emailIconUrl("https://acme.test", null)).toBe("https://acme.test/brand/icon-192.png");
    expect(emailIconUrl("https://acme.test", "branding/icon-1.png")).toBe("https://acme.test/uploads/branding/icon-1.png");
    expect(emailIconUrl("https://acme.test", "branding/icon-1.svg")).toBe("https://acme.test/brand/icon-192.png");
    expect(emailIconUrl("https://acme.test", "https://cdn.test/i.jpg")).toBe("https://cdn.test/i.jpg");
    expect(emailIconUrl("", null)).toBe("");
  });

  it("names the site under the card, linking only a safe address", () => {
    const linked = renderEmailBody("<p>x</p>", { ...vars, site_url: "https://acme.test" });
    expect(linked).toContain(`Sent by Acme &middot; <a href="https://acme.test"`);
    expect(linked).toContain(">acme.test</a>");
    const unsafe = renderEmailBody("<p>x</p>", { ...vars, site_url: "javascript:alert(1)" });
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).toContain("Sent by Acme</div>");
  });

  it("styles the tags the editor writes, keeping their own alignment", () => {
    expect(styleContent("<h2>Hi</h2>")).toMatch(/^<h2 style="font-size:19px/);
    expect(styleContent(`<p style="text-align: center">x</p>`)).toMatch(/style="color:#4a5250[^"]*;text-align: center"/);
  });

  it("renders a button placeholder from its url, replacing its paragraph", () => {
    const html = renderEmailBody("<p>{{reset_button}}</p>", vars);
    expect(html).toContain(`href="https://a.test/r?t=1"`);
    expect(html).toContain(">Set a new password</a>");
    expect(html).not.toMatch(/<p style="[^"]*"><table/);
  });

  it("puts the link's lifetime under the reset button", () => {
    expect(renderEmailBody("<p>{{reset_button}}</p>", { ...vars, expiry_minutes: "15" }))
      .toContain(">Link expires in 15 minutes and works once.</p>");
  });

  it("lists only the request details it knows, and no box with none", () => {
    const html = renderEmailBody("<p>{{request_box}}</p>", { ...vars, request_time: "24 Oct 2026, 14:05 UTC", request_device: "Firefox 130 · <Linux>" });
    expect(html).toContain(">Request details</td>");
    expect(html).toContain(">24 Oct 2026, 14:05 UTC</td>");
    expect(html).toContain(">Firefox 130 · &lt;Linux&gt;</td>");
    expect(html).not.toContain(">Location</td>");
    expect(renderEmailBody("<p>{{request_box}}</p>", vars)).not.toContain("Request details");
  });

  it("works out a request's time and device in the reader's language", async () => {
    const v = await requestVars({ ip: "127.0.0.1", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36" }, "de", new Date("2026-10-24T12:05:00Z"));
    expect(v.request_time).toMatch(/24\. Okt\. 2026.*\d/);
    expect(v.request_device).toBe("Chrome 141 · Windows");
    expect(v.request_location).toBe("");
  });

  it("links contact support to the admin's address, or shows the words", () => {
    const web = renderEmailBody("<p>Ask {{support_link}}.</p>", vars, "en", { ...EMAIL_DESIGN_DEFAULTS, support: "https://acme.test/help" });
    expect(web).toContain(`<a href="https://acme.test/help" style="color:#14796b">contact support</a>`);
    const mail = renderEmailBody("<p>{{support_link}}</p>", vars, "en", { ...EMAIL_DESIGN_DEFAULTS, support: "help@acme.test" });
    expect(mail).toContain(`href="mailto:help@acme.test"`);
    expect(renderEmailBody("<p>Ask {{support_link}}.</p>", vars)).toMatch(/Ask contact support\.<\/p>/);
  });

  it("takes only a web or email address as the support link", () => {
    expect(supportHref("javascript:alert(1)")).toBe("");
    expect(supportHref("https://a.test/x")).toBe("https://a.test/x");
    expect(supportHref(" a@b.test ")).toBe("mailto:a@b.test");
    expect(normalizeEmailDesign({ support: "javascript:x" }).support).toBe("");
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

describe("email design", () => {
  const vars = {
    site_name: "Acme", site_url: "https://acme.test",
    site_icon_url: "https://acme.test/brand/icon-192.png", site_logo_url: "https://acme.test/uploads/logo.png",
    reset_url: "https://acme.test/r",
  };
  const design = (over: Partial<typeof EMAIL_DESIGN_DEFAULTS>) => ({ ...EMAIL_DESIGN_DEFAULTS, ...over });

  it("keeps only safe values, whatever the stored row holds", () => {
    expect(normalizeEmailDesign(null)).toEqual(EMAIL_DESIGN_DEFAULTS);
    const bad = normalizeEmailDesign({ accent: "red;background:url(x)", page: "#FFF", header: "banner", footer: 5 });
    expect(bad).toEqual(EMAIL_DESIGN_DEFAULTS);
    expect(normalizeEmailDesign({ accent: "#AA0000" }).accent).toBe("#aa0000");
    expect(normalizeEmailDesign({ footer: "x".repeat(5000) }).footer).toHaveLength(4000);
  });

  it("paints the accent on the top line, buttons and links, and the page colour around the card", () => {
    const html = renderEmailBody(`<p>{{reset_button}}</p><p><a href="https://x.test">x</a></p>`, vars, "en",
      design({ accent: "#aa0000", page: "#102030" }));
    expect(html).toContain(`bgcolor="#aa0000" style="background-color:#aa0000;padding:28px 40px`);
    expect(html).toContain(`background-color:#aa0000;border-radius:8px`);
    expect(html).toContain(`<a href="https://x.test" style="color:#aa0000">`);
    expect(html).toContain(`bgcolor="#102030"`);
  });

  it("gives a light accent dark button text", () => {
    expect(inkOn("#ffd400")).toBe("#0d0d22");
    expect(inkOn("#0d7c72")).toBe("#ffffff");
  });

  it("renders each header, falling back to the name when an image is missing", () => {
    const icon = renderEmailBody("<p>x</p>", vars, "en", design({ header: "icon" }));
    expect(icon).toContain(`src="https://acme.test/brand/icon-192.png"`);
    expect(icon).toMatch(/>Acme<\/td>/);
    const logo = renderEmailBody("<p>x</p>", vars, "en", design({ header: "logo" }));
    expect(logo).toContain(`src="https://acme.test/uploads/logo.png"`);
    expect(logo).not.toMatch(/>Acme<\/td>/);
    const noLogo = renderEmailBody("<p>x</p>", { ...vars, site_logo_url: "" }, "en", design({ header: "logo" }));
    expect(noLogo).toContain("icon-192.png");
    const name = renderEmailBody("<p>x</p>", vars, "en", design({ header: "name" }));
    expect(name).not.toContain("<img");
  });

  it("shows a footer note from the editor, cleaned and in the footer's small scale", () => {
    const html = renderEmailBody("<p>x</p>", vars, "en", design({
      footer: `<p style="text-align: center">Acme <strong>Ltd</strong></p><h1>Hi</h1><p><a href="https://acme.test/x">Visit</a><script>alert(1)</script></p><img src=x onerror=alert(1)>`,
    }));
    expect(html).toContain(`<p style="margin:0 0 4px;text-align:center">Acme <strong>Ltd</strong></p>`);
    expect(html).toContain(`<h1 style="font-size:14px;font-weight:700;margin:0 0 4px">Hi</h1>`);
    expect(html).toContain(`<a href="https://acme.test/x" rel="noopener noreferrer nofollow" style="color:#14796b">Visit</a>`);
    expect(html).not.toMatch(/script|onerror/);
  });

  it("leaves no footer note for an empty editor", () => {
    const html = renderEmailBody("<p>x</p>", vars, "en", design({ footer: "<p></p>" }));
    expect(html).not.toContain(`<div style="margin:0 0 6px">`);
  });

  it("shows the footer note as escaped text, line breaks kept", () => {
    const html = renderEmailBody("<p>x</p>", vars, "en", design({ footer: "Acme Ltd\n<b>Main St</b>" }));
    expect(html).toContain("Acme Ltd<br>&lt;b&gt;Main St&lt;/b&gt;");
  });

  it("builds the notification button from its link and label", () => {
    const html = renderEmailBody("<p>{{link_button}}</p>", { ...vars, link_url: "https://acme.test/t/1", link_label: "Open" }, "en");
    expect(html).toContain(`href="https://acme.test/t/1"`);
    expect(html).toContain(">Open</a>");
  });

  it("takes only images a mail client can show as the logo", () => {
    expect(emailImageUrl("https://acme.test", "branding/logo.webp")).toBe("");
    expect(emailImageUrl("https://acme.test", "branding/logo.png")).toBe("https://acme.test/uploads/branding/logo.png");
    expect(emailImageUrl("", "branding/logo.png")).toBe("");
  });
});
