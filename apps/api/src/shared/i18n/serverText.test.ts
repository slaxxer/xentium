import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_LOCALES, serverText, toServerLocale } from "./serverText.js";
import { EMAIL_TEMPLATE_KEYS, defaultTemplate, renderEmailBody } from "../../infrastructure/email/email-templates.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

function keys(tree: unknown, prefix = ""): string[] {
  if (typeof tree !== "object" || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)).sort();
}

describe("server texts", () => {
  // The bell reads the web copy, a notification email this one: they must not drift.
  it.each(SERVER_LOCALES)("notifications.json equals the web's common:notify (%s)", (lng) => {
    const web = read(`../../../../web/public/locales/${lng}/common.json`).notify;
    expect(read(`../../locales/${lng}/notifications.json`)).toEqual(web);
  });

  it.each(SERVER_LOCALES)("email.json has every English key (%s)", (lng) => {
    expect(keys(read(`../../locales/${lng}/email.json`))).toEqual(keys(read("../../locales/en/email.json")));
  });

  it("fills values and falls back to English", () => {
    expect(serverText("de", "notifications", "newFollower.body", { name: "ada" })).toBe("ada folgt dir jetzt.");
    expect(serverText("de", "email", "no.such.key")).toBe("no.such.key");
  });

  it("maps browser languages onto the shipped ones", () => {
    expect(toServerLocale("de-AT")).toBe("de");
    expect(toServerLocale("ja")).toBeNull();
    expect(toServerLocale(undefined)).toBeNull();
  });

  it.each(SERVER_LOCALES)("every shipped template keeps its placeholders (%s)", (lng) => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const en = defaultTemplate(key, "en");
      const own = defaultTemplate(key, lng);
      const used = (s: string) => [...s.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]).sort();
      expect(used(own.subject + own.body), `${lng} ${key}`).toEqual(used(en.subject + en.body));
    }
  });

  it("writes the buttons in the recipient's language", () => {
    const html = renderEmailBody("<p>{{reset_button}}</p>", { reset_url: "https://a.test/r" }, "de");
    expect(html).toContain("Passwort zurücksetzen →");
  });
});
