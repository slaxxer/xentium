/**
 * How a premade text is filled in for a report, and which one a report suggests.
 */
import { describe, expect, it } from "vitest";
import { fill, fillSegments, suggest, typeLabel, type Template } from "./modTemplates";

const t = (over: Partial<Template>): Template => ({
  id: over.name ?? "x", mode: "warn", name: "x", text: "", ruleRef: null, defaultDuration: null,
  internal: false, matchCategories: [], useCount: 0, updatedAt: "", ...over,
});

const vars = { user: "mara", type: "comment", where: "Launch notes", duration: "7 days" };

describe("fill", () => {
  it("fills every known variable and leaves unknown braces alone", () => {
    expect(fill("Hi {user}, your {type} on {where}: {duration}. {nope}", vars))
      .toBe("Hi mara, your comment on Launch notes: 7 days. {nope}");
    expect(fillSegments("Hi {user}!", vars)).toEqual([
      { text: "Hi ", filled: false }, { text: "mara", filled: true }, { text: "!", filled: false },
    ]);
  });

  it("names the content in words", () => {
    expect(typeLabel("article_comment")).toBe("comment");
    expect(typeLabel("profile_comment")).toBe("profile comment");
    expect(typeLabel("shoutbox_shout")).toBe("shoutbox shout");
  });
});

describe("suggest", () => {
  const warn = t({ name: "Harassment", mode: "warn", matchCategories: ["harassment"] });
  const ban = t({ name: "Repeated harassment", mode: "ban", matchCategories: ["harassment"], useCount: 9 });
  const spamWarn = t({ name: "Spam", mode: "warn", matchCategories: ["spam", "advert"] });
  const dismiss = t({ name: "No violation", mode: "dismiss" });

  it("picks the template whose categories the reasons mention most", () => {
    expect(suggest([warn, spamWarn], ["Spam advert", "spam"], true)?.name).toBe("Spam");
  });

  it("breaks a tie toward the milder action, whatever the order or the usage", () => {
    expect(suggest([ban, warn], ["harassment"], true)?.name).toBe("Harassment");
    expect(suggest([warn, ban], ["harassment"], true)?.name).toBe("Harassment");
  });

  it("never suggests warning or banning when there is no author", () => {
    expect(suggest([warn, ban, dismiss], ["harassment"], false)?.name).toBe("No violation");
  });
});
