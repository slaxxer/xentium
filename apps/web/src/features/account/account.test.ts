/**
 * The two pieces of the account page that are logic rather than layout.
 *
 * The save bar's COUNT is the page's main claim about itself, and the session list's
 * device name is the only place a raw user-agent is turned into something a member
 * is expected to recognise.
 */
import { describe, expect, it } from "vitest";
import { countPrivacyChanges, PRIVACY_DEFAULTS, type Form } from "./tabs/PrivacyTab";
import { deviceName } from "./tabs/SecurityTab";

const SAVED: Form = {
  settings:        { ...PRIVACY_DEFAULTS },
  dobDisplay:      "age",
  dobVisibility:   "public",
  linksVisibility: "public",
};

/** A form that differs from `SAVED` in exactly the ways given. */
function form(
  patch: Omit<Partial<Form>, "settings"> & { settings?: Partial<Form["settings"]> },
): Form {
  return {
    ...SAVED,
    ...patch,
    settings: { ...SAVED.settings, ...(patch.settings ?? {}) },
  };
}

describe("counting unsaved privacy changes", () => {
  it("is zero for an untouched form", () => {
    expect(countPrivacyChanges(form({}), SAVED)).toBe(0);
  });

  /** ⚠ A new object with the same answers is NOT a change. The form is rebuilt on
   *  every keystroke elsewhere on the page, so identity cannot be the test. */
  it("is zero when the values match but the objects differ", () => {
    expect(countPrivacyChanges({ ...SAVED, settings: { ...SAVED.settings } }, SAVED)).toBe(0);
  });

  it("counts one per answer that moved", () => {
    expect(countPrivacyChanges(form({ settings: { profileVisibility: "members" } }), SAVED)).toBe(1);
    expect(countPrivacyChanges(
      form({ settings: { profileVisibility: "members", whoCanFollow: "nobody" } }), SAVED)).toBe(2);
  });

  /** The three answers that are not part of the privacy-settings blob. */
  it("counts the birthday and the links, which live on other endpoints", () => {
    expect(countPrivacyChanges(form({ dobDisplay: "hidden" }), SAVED)).toBe(1);
    expect(countPrivacyChanges(form({ dobVisibility: "nobody" }), SAVED)).toBe(1);
    expect(countPrivacyChanges(form({ linksVisibility: "members" }), SAVED)).toBe(1);
    expect(countPrivacyChanges(
      form({ dobDisplay: "birthday", dobVisibility: "members", linksVisibility: "nobody" }),
      SAVED,
    )).toBe(3);
  });

  it("counts a switch turned off, not just a select changed", () => {
    expect(countPrivacyChanges(form({ settings: { allowProfileComments: false } }), SAVED)).toBe(1);
  });

  /** Changed and changed back is not a change — the whole reason this is a diff. */
  it("goes back to zero when an answer is restored", () => {
    const edited = form({ settings: { whoCanComment: "nobody" } });
    expect(countPrivacyChanges(edited, SAVED)).toBe(1);
    expect(countPrivacyChanges(form({ settings: { whoCanComment: "everyone" } }), SAVED)).toBe(0);
  });
});

describe("naming a session's device", () => {
  it("reads the browser and the platform out of a real user-agent", () => {
    expect(deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "?",
    )).toBe("Chrome 141 · macOS");

    expect(deviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "?",
    )).toBe("Safari 17 · iOS");

    expect(deviceName(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "?",
    )).toBe("Edge 140 · Windows");

    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "?"))
      .toBe("Firefox 130 · Linux");
  });

  /** ⚠ Never a blank row: an agent we cannot parse is shown as itself, truncated. */
  it("falls back to the raw string, and to the given label when there is none", () => {
    expect(deviceName("SomeCustomAgent/9", "?")).toBe("SomeCustomAgent/9");
    expect(deviceName(null, "Unknown device")).toBe("Unknown device");
    expect(deviceName("", "Unknown device")).toBe("Unknown device");
  });

  /** Chrome's UA also contains "Safari/537.36"; the order of the alternation is what
   *  keeps it from being reported as Safari. */
  it("does not mistake Chrome for Safari", () => {
    expect(deviceName(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      "?",
    )).toBe("Chrome 151 · Linux");
  });
});
