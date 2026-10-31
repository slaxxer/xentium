/**
 * Everything the frontend shows a reader is translated — and stays translated.
 *
 *  1. Every English key exists in every bundled language.
 *  2. Text core defines IN CODE (block names, block settings, permissions) has its
 *     `acp:core` entry; the English in code is only the fallback a plugin relies on.
 *  3. No component hard-codes visible text: JSX text, and the attributes a reader
 *     sees or hears (`alt`, `title`, `aria-label`, `placeholder`), go through `t()`.
 *
 * A miss in any of these renders English in a German UI without anything failing,
 * which is why it is a test and not a review checklist.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { blockPropSchemas, CorePermissions, XEC } from "@xentium/contracts";
import { enrichPerm } from "./permissions";
import { CHROME_SETTINGS } from "../features/admin/pages/ChromeSettings";
import { BACKGROUND_PROPS } from "../features/admin/pages/BlockBackground";

const LOCALES = join(__dirname, "../../public/locales");
const SRC = join(__dirname, "..");
const LANGS = ["de", "es", "fr", "pt"] as const;

type Tree = { [k: string]: string | Tree };

function load(lng: string, ns: string): Tree {
  return JSON.parse(readFileSync(join(LOCALES, lng, `${ns}.json`), "utf8")) as Tree;
}

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const NAMESPACES = readdirSync(join(LOCALES, "en")).map((f) => f.replace(/\.json$/, ""));

describe("locale parity", () => {
  for (const ns of NAMESPACES) {
    const en = flatten(load("en", ns));
    for (const lng of LANGS) {
      it(`${lng}/${ns} has every English key`, () => {
        const have = flatten(load(lng, ns));
        const plurals = new Set([...have.keys()].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
        // Plural forms differ per language: an English `_one`/`_other` pair is
        // covered by any plural form of the same base.
        const missing = [...en.keys()].filter((k) =>
          PLURAL.test(k) ? !plurals.has(k.replace(PLURAL, "")) && !have.has(k) : !have.has(k));
        expect(missing, `missing in ${lng}/${ns}.json`).toEqual([]);
      });
    }
  }
});

const core = (load("en", "acp") as { core: Tree }).core as {
  blocks: Record<string, { label?: string; props?: Record<string, Tree> }>;
  permissions: Record<string, string>;
  domains: Record<string, string>;
};

interface Prop {
  type?: string; title?: string; description?: string;
  enum?: unknown[]; const?: unknown; anyOf?: Prop[];
}

describe("text core defines in code", () => {
  it("names every core block", () => {
    const missing = Object.keys(blockPropSchemas).filter((t) => !core.blocks[t]?.label);
    expect(missing, "acp:core.blocks.<type>.label").toEqual([]);
  });

  it("translates every core block setting the inspector can show", () => {
    const missing: string[] = [];
    for (const [type, schema] of Object.entries(blockPropSchemas)) {
      // The site chrome's bands draw their own panels (ChromeSettings), translated there.
      if (CHROME_SETTINGS[type]) continue;
      let json: { properties?: Record<string, Prop> };
      try {
        json = z.toJSONSchema(schema as never, { io: "input" }) as typeof json;
      } catch {
        continue;
      }
      for (const [key, raw] of Object.entries(json.properties ?? {})) {
        const prop = raw.anyOf?.every((b) => b.const !== undefined)
          ? { ...raw, enum: raw.anyOf.map((b) => b.const) }
          : raw;
        const shown = prop.enum || ["string", "number", "integer", "boolean"].includes(prop.type ?? "")
          || prop.anyOf?.some((b) => ["string", "number", "integer", "boolean"].includes(b.type ?? ""));
        // Background props get their own picker (BlockBackgroundFields), never a generic field.
        if (!shown || (BACKGROUND_PROPS as readonly string[]).includes(key)) continue;
        const entry = (core.blocks[type]?.props?.[key] ?? {}) as Tree & { enum?: Tree };
        if (!entry.title) missing.push(`${type}.props.${key}.title`);
        if (prop.description && !entry.description) missing.push(`${type}.props.${key}.description`);
        for (const v of prop.enum ?? []) {
          if (typeof v === "string" && !entry.enum?.[v]) missing.push(`${type}.props.${key}.enum.${v}`);
        }
      }
    }
    expect(missing, "acp:core.blocks.*").toEqual([]);
  });

  it("names every core permission and the group it is listed under", () => {
    const keys = Object.values(CorePermissions) as string[];
    const missing = keys.filter((k) => !core.permissions[k]);
    // Grouping is by the English domain enrichPerm assigns — the key of `acp:core.domains`.
    const domains = [...new Set(keys.map((k) => enrichPerm({ id: k, key: k, label: "", domain: "" }).domain))]
      .filter((d) => !core.domains[d]);
    expect([...missing, ...domains.map((d) => `domain:${d}`)], "acp:core.permissions / domains").toEqual([]);
  });

  it("translates every core error code a reader can see", () => {
    // These keep the server's own message on purpose: it names the file, rule,
    // version or reason, and `apiErrorMessage` would swap it for a generic line.
    const SERVER_MESSAGE = new Set([
      "XEC-API-4009", "XEC-AUTH-1076", "XEC-PLUGIN-2001", "XEC-PLUGIN-2010", "XEC-PLUGIN-2012",
      "XEC-PLUGIN-2013", "XEC-PLUGIN-2030", "XEC-LICENSE-9004", "XEC-LICENSE-9009",
      "XEC-MARKETPLACE-9103", "XEC-CORE-8002", "XEC-EMAIL-8603", "XEC-QUEUE-5000", "XEC-QUEUE-5001",
    ]);
    // Add-ons translate their own codes in their own namespace.
    const ADDON_DOMAINS = ["XEC-FORUM-", "XEC-STORE-"];
    const errors = flatten(load("en", "errors"));
    const missing = (Object.values(XEC) as string[]).filter((c) =>
      !errors.has(c) && !SERVER_MESSAGE.has(c) && !ADDON_DOMAINS.some((d) => c.startsWith(d)));
    expect(missing, "errors:<code>").toEqual([]);
  });
});

/* ── 3. hard-coded visible text ─────────────────────────────────────────── */

/**
 * Text that reads the same in every language: product and language names, a
 * technical token, a key label. Kept short ON PURPOSE — anything a reader would
 * expect in their own language does not belong here.
 */
const UNTRANSLATABLE = new Set([
  "Xentium", "xentium", "PostgreSQL", "Redis", "English", "English (US)", "Español", "Français",
  "Deutsch", "Português", "you@example.com", "#rrggbb", "Ctrl S", "⌘S", ".env · mode 0600", "esc",
  "1.0.0", "localhost", "UTC", "Aa", "OK", "px", "ms", "node", "Ctrl↵", "XEC 500", "site.frame ·", "› articles",
]);

/** A value that shows the FORMAT of an input (`https://`, `vip_members`, `admin.access`), not a sentence. */
const FORMAT_EXAMPLE = /^(?:[a-z][a-z0-9+.-]*:\/\/\S*|[a-z0-9]+(?:[-_.:][a-z0-9]+)+)$/;

/** Attributes a reader sees (a tooltip, a placeholder) or hears (alt, aria-*). */
/** `defaultValue` is the text a specimen field starts with. */
const VISIBLE_ATTRS = new Set(["alt", "title", "aria-label", "aria-description", "aria-placeholder", "placeholder", "defaultValue"]);

const ROOTS = [SRC, join(__dirname, "../../../../packages/ui/src")];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "generated" && name !== "node_modules") sources(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function needsTranslation(text: string): boolean {
  const s = text.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(s) || UNTRANSLATABLE.has(s)) return false;
  // CSS shown as an example (the custom-CSS console's placeholder) is code.
  if (/^:root\s*\{/.test(s)) return false;
  return !FORMAT_EXAMPLE.test(s);
}

/**
 * String literals that END UP as the value: through `a ? "x" : "y"`, `a ?? "x"`,
 * `a || "x"` and parentheses — never into a call (`t("key")`) or a template's
 * code, which are not the reader's text.
 */
function valueLiterals(node: ts.Node): ts.StringLiteralLike[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return valueLiterals(node.expression);
  if (ts.isConditionalExpression(node)) return [...valueLiterals(node.whenTrue), ...valueLiterals(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
    return [...valueLiterals(node.left), ...valueLiterals(node.right)];
  }
  return [];
}

function visibleLiterals(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const at = (n: ts.Node) => `${relative(SRC, file)}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && needsTranslation(n.text)) {
      hits.push(`${at(n)}  "${n.text.replace(/\s+/g, " ").trim()}"`);
    } else if (ts.isJsxAttribute(n) && VISIBLE_ATTRS.has(n.name.getText(src)) && n.initializer) {
      const init = n.initializer;
      const lits = ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) && init.expression ? valueLiterals(init.expression) : [];
      for (const l of lits) if (needsTranslation(l.text)) hits.push(`${at(l)}  ${n.name.getText(src)}="${l.text}"`);
    } else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      for (const l of valueLiterals(n.expression)) if (needsTranslation(l.text)) hits.push(`${at(l)}  {"${l.text}"}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

describe("no hard-coded visible text", () => {
  it("routes JSX text, alt, title, aria-label and placeholder through t()", () => {
    const hits = ROOTS.flatMap((r) => sources(r)).flatMap(visibleLiterals);
    expect(hits).toEqual([]);
  });
});
