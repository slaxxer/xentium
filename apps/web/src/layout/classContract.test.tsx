/**
 * The class contract themes style against.
 *
 * @vitest-environment jsdom
 *
 * A theme is CSS plus data — it cannot register a block or change a component — so every
 * bit of design control it has runs through class names. That makes those names a
 * compatibility surface as binding as a prop, and this file is what stops them moving by
 * accident.
 *
 * Three separate promises, and they are guarded differently because they are different
 * kinds of thing:
 *
 *  1. **`nv-b--<type>` on every block.** Derived from the registry key, stamped by the
 *     renderer, so it holds for core, plugin and future blocks alike. Guarded by
 *     enumerating the registry — a block cannot be added without it.
 *  2. **Root classes** for the blocks that own a root element. A short list; most blocks
 *     render into their parent's markup and have none, which is exactly why (1) exists.
 *  3. **No combinator may cross a block boundary.** Every block is wrapped in a
 *     `display: contents` element, and selectors match the DOM rather than the box tree,
 *     so `>`/`+`/`~` against a block's root silently stops matching. This is not
 *     hypothetical: `.nv-columns > .nv-column` shipped and broke the mobile collapse for
 *     any column an admin had given a variant, leaving a sticky rail pinned over the
 *     content it was supposed to stack under.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { blockTypeClass, type BlockNode, type LayoutDocument } from "@nodevo/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { listBlocks } from "./blockRegistry";
import "./blocks/coreBlocks";
import "./blocks/chromeBlocks";
import "./blocks/guestBlocks";
import "./blocks/homeBlocks";
import "./blocks/memberBlocks";
import "./blocks/pageDetailBlocks";
import "./blocks/pageTemplateBlocks";
import "./blocks/profileBlocks";

afterEach(cleanup);

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions: { main: nodes } });

// ── 1. The type class ───────────────────────────────────────────────────────

describe("nv-b--<type>", () => {
  it("is a usable CSS identifier for a plugin's dotted type", () => {
    // `forum.recentThreads` cannot appear in a selector unescaped.
    expect(blockTypeClass("forum.recentThreads")).toBe("nv-b--forum-recentThreads");
    expect(blockTypeClass("heading")).toBe("nv-b--heading");
    expect(blockTypeClass("slot.headerWidget.x")).toBe("nv-b--slot-headerWidget-x");
  });

  it("is stamped on EVERY registered block, on the live site", () => {
    // The point of the contract: a theme can target any block type without the admin
    // having added a handle, including blocks that render nothing on their own.
    for (const def of listBlocks()) {
      const parsed = def.schema.safeParse({});
      const props = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
      const { container } = render(
        <LayoutRegion document={doc([{ id: "x", type: def.type, props }])} region="main" />,
      );
      const hook = container.querySelector(`.${CSS.escape(blockTypeClass(def.type))}`);
      expect(hook, `block "${def.type}" has no type class`).not.toBeNull();
      cleanup();
    }
  });

  it("generates no box, so it can never disturb a flex or grid parent", () => {
    render(<LayoutRegion document={doc([
      { id: "h", type: "heading", props: { text: "Hi", level: 2, align: "start" } },
    ])} region="main" />);
    const el = document.querySelector(".nv-b--heading") as HTMLElement;
    expect(el.style.display).toBe("contents");
  });

  it("shares ONE wrapper with the variant and the handle", () => {
    render(<LayoutRegion document={doc([
      { id: "h", type: "heading", props: { text: "Hi", level: 2, align: "start" },
        variant: "accent", className: "nav-tile" },
    ])} region="main" />);
    const el = document.querySelector(".nv-b--heading") as HTMLElement;
    expect(el.classList.contains("nv-v--accent")).toBe(true);
    expect(el.classList.contains("nav-tile")).toBe(true);
    // One wrapper, not three nested ones.
    expect(el.querySelectorAll(".nv-b--heading, .nv-v--accent, .nav-tile")).toHaveLength(0);
  });

  it("makes the live DOM match the editor preview's shape", () => {
    // These used to differ: the preview wrapped every block, the live site only a
    // styled one. CSS written while looking at the preview could break on publish.
    render(<LayoutRegion document={doc([
      { id: "s", type: "section", props: { width: "normal", padding: "md" },
        children: [{ id: "h", type: "heading", props: { text: "Hi", level: 2, align: "start" } }] },
    ])} region="main" />);
    const region = document.querySelector(".nv-region") as HTMLElement;
    expect(region.firstElementChild!.classList.contains("nv-b--section")).toBe(true);
    expect(document.querySelector(".nv-b--section .nv-section .nv-b--heading .nv-heading"))
      .not.toBeNull();
  });
});

// ── 2. Root classes ─────────────────────────────────────────────────────────

/**
 * Blocks that own a root element, and the class on it.
 *
 * Deliberately only the blocks that render standalone — the rest resolve their content
 * from host context and emit nothing without it, so a render-based assertion would be
 * asserting the absence of data rather than the presence of a contract.
 *
 * ⚠ Changing a value here is a BREAKING change for themes. Update the table in
 * `docs/theme-packages.md` in the same commit.
 */
const ROOT_CLASSES: Record<string, string> = {
  section:     "nv-section",
  columns:     "nv-columns",
  column:      "nv-column",
  spacer:      "nv-spacer",
  heading:     "nv-heading",
  richText:    "nv-richtext",
  image:       "nv-image",
  guestHero:   "ghero",
  guestBody:   "gbody",
  profileCard: "profile-card",
};

/**
 * `nv-block` — the class that says "a block drew here", on every wrapper.
 *
 * A rail and a column collapse when nothing inside them rendered, and the test for
 * that is `:has(.nv-block:not(:empty))`. The renderer's OTHER handle,
 * `data-nv-block`, is stamped in the EDITOR only — a rule written against it matched
 * nothing on the real page and collapsed every track on it. So this class is a
 * layout dependency, not decoration.
 */
describe("nv-block", () => {
  it("is on every block wrapper, on the live site", () => {
    const nodes: BlockNode[] = [
      { id: "a", type: "heading", props: { text: "H", level: 2 } },
      { id: "b", type: "richText", props: {} },
      { ...({ id: "c", type: "section", props: { width: "normal", padding: "md" } } as BlockNode),
        children: [{ id: "d", type: "spacer", props: { size: "md" } }] },
    ];
    const { container } = render(<LayoutRegion document={doc(nodes)} region="main" />);
    const wrappers = [...container.querySelectorAll("[class*='nv-b--']")];
    expect(wrappers.length).toBeGreaterThan(3);
    for (const w of wrappers) {
      expect([...w.classList], w.className).toContain("nv-block");
    }
  });
});

describe("root classes", () => {
  it("still exist in the source that emits them", () => {
    // Static rather than rendered, because most of these blocks need host data to
    // render at all — and the promise is about the NAME, which the source is the
    // authority on. A rename removes it here and fails loudly instead of silently
    // breaking every theme that targeted it.
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "blocks");
    const source = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");

    for (const [type, cls] of Object.entries(ROOT_CLASSES)) {
      expect(source, `root class "${cls}" for block "${type}" is gone`).toContain(cls);
    }
  });

  it("is emitted for the blocks that can render without host data", () => {
    const standalone = ["section", "columns", "column", "spacer", "richText"] as const;
    for (const type of standalone) {
      const { container } = render(
        <LayoutRegion document={doc([{ id: "x", type, props: {} }])} region="main" />,
      );
      expect(container.querySelector(`.${ROOT_CLASSES[type]}`), type).not.toBeNull();
      cleanup();
    }
  });
});

// ── 3. No combinator may cross a block boundary ─────────────────────────────

describe("stylesheets", () => {
  it("never reach across a block boundary with >, + or ~", () => {
    // The wrapper is in the DOM even though it generates no box, so any combinator
    // aimed at a block's ROOT class from outside that block silently stops matching
    // the moment an admin gives the block a variant or a handle.
    const roots = [...new Set(Object.values(ROOT_CLASSES))];
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

    const scss: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".scss")) scss.push(full);
      }
    };
    walk(src);

    // Comments are stripped rather than skipped line-by-line: this rule is EXPLAINED in
    // a block comment sitting directly above the code it governs, and a line-prefix
    // check reported that prose as the violation.
    const decomment = (css: string) =>
      css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
         .replace(/\/\/[^\n]*/g, "");

    const offences: string[] = [];
    for (const file of scss) {
      decomment(fs.readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
        for (const cls of roots) {
          if (new RegExp(`[>+~]\\s*\\.${cls}\\b`).test(line)) {
            offences.push(`${path.relative(src, file)}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }

    expect(offences, `a combinator crosses a block boundary:\n${offences.join("\n")}`)
      .toHaveLength(0);
  });
});

// ── 4. The chrome wrapper must not trap the sticky navbar ───────────────────

describe("site chrome", () => {
  /**
   * `position: sticky` is constrained by its PARENT's box, not by the viewport.
   *
   * When `PubNav` grew a `<header>` around the nav strip so the masthead bands had
   * somewhere to live, that wrapper became the navbar's containing block — and it is
   * only as tall as the chrome. The navbar stuck for ~48px of scroll and then
   * travelled off the top of every page on the site. Typecheck, lint and the whole
   * suite stayed green; only scrolling the real page showed it.
   *
   * `display: contents` dissolves the box while keeping the element for semantics,
   * which is the same reason the region and variant wrappers use it. This asserts the
   * fix rather than the symptom, because jsdom performs no layout and cannot scroll.
   */
  it("dissolves the <header> box, so the sticky navbar spans the page", () => {
    const scss = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../layouts/AppLayout.scss"),
      "utf8",
    );
    const block = scss.slice(scss.indexOf(".pub-head {"));
    const body = block.slice(0, block.indexOf("\n}"));
    // BOTH wrappers. The navbar is a block inside the header REGION now, so the
    // region's own element is a second box between the nav and the page — and one
    // box is enough to trap sticky. It also has to go for a second reason: a
    // `.nv-region` is a centred content column, and site chrome spans the viewport.
    expect(body).toMatch(/display:\s*contents/);
    expect(body).toMatch(/\.nv-region--header\s*\{\s*display:\s*contents/);
  });
});
