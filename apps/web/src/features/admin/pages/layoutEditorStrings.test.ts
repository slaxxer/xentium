/**
 * Every `layoutEditor.*` key the editor asks for exists, in every language.
 *
 * Written after a key was added to the WRONG SECTION of five bundles at once — the
 * insertion was anchored on a `"saving"` that also exists under `settings`, so the
 * files stayed valid JSON, the build stayed green, and the toolbar rendered the
 * literal string `layoutEditor.aheadOfLive` to the admin. Nothing else in the suite
 * looks at a translation key, so nothing else could have caught it.
 *
 * ⚠ The scan is deliberately dumb: a regex over the source for `layoutEditor.<key>`.
 * It cannot see a key built at runtime (`layoutEditor.device.${id}`), which is why
 * DYNAMIC_PREFIXES exists — those are checked as whole sub-objects instead.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const WEB = join(HERE, "..", "..", "..", "..");
const LOCALES = join(WEB, "public", "locales");
const SOURCES = [
  join(HERE, "LayoutEditorPage.tsx"),
  join(HERE, "LayoutTree.tsx"),
  join(HERE, "BlockStyle.tsx"),
  join(HERE, "BlockVisibility.tsx"),
  join(HERE, "BlockBackground.tsx"),
];

/**
 * Keys assembled from a variable, checked as sub-objects rather than leaves.
 *
 * `t("layoutEditor.template." + key)` cannot be resolved by reading the source, and a
 * template list is open-ended anyway — a plugin's template has no core string.
 */
const DYNAMIC_PREFIXES = ["region", "pageRegion", "template", "category", "device",
  "audience", "audienceView", "group"];

const bundle = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(LOCALES, locale, "acp.json"), "utf8")) as Record<string, unknown>;

const locales = readdirSync(LOCALES).filter((d) => !d.startsWith("."));

/** Literal `layoutEditor.<key>` references, minus the dynamic families. */
const referenced = (): string[] => {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(/["'`]layoutEditor\.([A-Za-z0-9_.]+)["'`]/g)) {
      const key = match[1];
      if (!key) continue;
      // A trailing dot means the key was being concatenated — not a literal.
      if (key.endsWith(".")) continue;
      if (DYNAMIC_PREFIXES.includes(key.split(".")[0]!)) continue;
      found.add(key);
    }
  }
  return [...found].sort();
};

const lookup = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
    obj,
  );

describe("layout editor strings", () => {
  it("finds keys to check at all", () => {
    // A guard on the guard: if the scan silently matched nothing — the import moved,
    // the quoting changed — every other assertion here would pass vacuously.
    expect(referenced().length).toBeGreaterThan(40);
  });

  it.each(locales)("%s translates every key the editor asks for", (locale) => {
    const b = bundle(locale);
    const missing = referenced().filter((key) => typeof lookup(b.layoutEditor, key) !== "string");
    expect(missing).toEqual([]);
  });

  it.each(locales)("%s keeps the dynamic families whole", (locale) => {
    const b = bundle(locale);
    const editor = b.layoutEditor as Record<string, unknown>;
    for (const prefix of DYNAMIC_PREFIXES) {
      expect(typeof editor[prefix], `layoutEditor.${prefix} in ${locale}`).toBe("object");
    }
  });

  it.each(locales)("%s puts the editor's strings under layoutEditor, not elsewhere", (locale) => {
    // The actual failure that prompted this: keys landed in `settings`, so they were
    // present in the file and absent where they were read from.
    const b = bundle(locale);
    const settings = (b.settings ?? {}) as Record<string, unknown>;
    const strays = ["autosaved", "aheadOfLive", "draftActions", "documentLabel"]
      .filter((k) => k in settings);
    expect(strays).toEqual([]);
  });
});
