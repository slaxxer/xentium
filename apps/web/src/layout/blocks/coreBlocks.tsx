/**
 * Core block catalogue (ADR-0005, v1).
 *
 * Importing this module registers the blocks. Props stay COARSE: fine visual
 * control belongs to the Style Editor tokens (ADR-0003), and every prop added
 * here is permanent, because stored documents — including ones inside purchased
 * themes — must migrate forever.
 */
import { Children } from "react";
import { useTranslation } from "react-i18next";
import { blockPropSchemas, blockTypesIn, type LocalizedText } from "@xentium/contracts";
import { LayoutWidgetOutlet } from "../../plugins/LayoutWidgetOutlet";
import { ArticleContent } from "../../features/articles/components/ArticleContent";
import { registerBlock, type BlockProps } from "../blockRegistry";
import { useRenderedDocument } from "../LayoutRenderer";
import { individuallyPlacedSlotIds } from "../slotBlocks";
import { ArticleIndexBlock } from "./ArticleIndexBlock";
import "./coreBlocks.scss";
import { TokenIcon } from "../../components/TokenIcon";

/**
 * Resolve a `LocalizedText`. Core default documents carry i18n references so
 * converting a page into a document does not hardcode English; admin-typed
 * strings are literals.
 */
function useText(value: LocalizedText | undefined): string {
  const { t } = useTranslation();
  if (value == null) return "";
  if (typeof value === "string") return value;
  return t(value.key, { ns: value.ns }) as string;
}

// ── Structure ───────────────────────────────────────────────────────────────

/**
 * The section's background, as a CSS `background-image` value.
 *
 * Image and gradient COMPOSE: CSS paints the first layer on top, so the image sits
 * over the gradient and either alone works. Returns undefined when neither is set,
 * so an untouched section emits no inline style at all and keeps painting exactly
 * what its style variant gives it.
 *
 * ⚠ The values are already schema-validated (`cssColorSchema`, and an asset path or
 * URL) — this composes them, it does not sanitise them. A document is untrusted
 * input, so the guarantee has to live in the schema where a `.nvtheme` import hits
 * it too, not in a renderer a plugin could bypass.
 */
export function sectionBackground(props: {
  backgroundImage?: string;
  backgroundGradient?: string[];
  backgroundAngle?: number;
}): string | undefined {
  const layers: string[] = [];
  if (props.backgroundImage?.trim()) {
    layers.push(`url("${resolveImageSource(props.backgroundImage.trim())}")`);
  }
  const stops = (props.backgroundGradient ?? []).filter((c) => c.trim());
  if (stops.length) {
    // One colour is a flat fill, which `linear-gradient` cannot express with a
    // single stop — repeat it so "pick one colour" does the obvious thing.
    const list = stops.length === 1 ? [stops[0]!, stops[0]!] : stops;
    layers.push(`linear-gradient(${props.backgroundAngle ?? 180}deg, ${list.join(", ")})`);
  }
  return layers.length ? layers.join(", ") : undefined;
}

function SectionBlock({ props, children }: BlockProps<{
  width: string; padding: string; minHeight?: number;
  backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number;
}>) {
  const background = sectionBackground(props);
  const tall = (props.minHeight ?? 0) > 0;
  const classes = [
    "nv-section",
    `nv-section--${props.width}`,
    `nv-section--pad-${props.padding}`,
    background ? "nv-section--bg" : "",
    tall ? "nv-section--tall" : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      className={classes}
      style={{
        ...(background ? { backgroundImage: background } : {}),
        ...(tall ? { minHeight: `${props.minHeight}px` } : {}),
      }}
    >
      {/**
       * The content column, and the reason a full-bleed section still lines up with
       * the rest of the page.
       *
       * A `width: full` section spans the viewport so its background does, but its
       * CONTENT belongs in the same rail as the navbar and the page body — a masthead
       * logo hard against the window edge while the nav logo below it sits inset is
       * the thing that makes a band look bolted on. The wrapper is unconditional so
       * the DOM shape does not change with the width prop; it only takes on a
       * max-width when the section is full.
       */}
      <div className="nv-section__inner">{children}</div>
    </section>
  );
}

registerBlock({
  type:      "section",
  schema:    blockPropSchemas.section,
  container: true,
  editorMeta: { label: "Section", category: "structure", wide: true },
  component: SectionBlock,
});

registerBlock({
  type:      "columns",
  schema:    blockPropSchemas.columns,
  container: true,
  // A track is a `column`; nothing else may sit directly in the row, or a bare
  // block would land where a track belongs and the grid would read as broken.
  childTypes: ["column"],
  editorMeta: { label: "Columns", category: "structure", wide: true },
  // Collapse is intrinsic to the block, never an admin knob — that is what stops
  // a non-developer producing a layout that is broken on mobile.
  component: ({ props, children }) => {
    // The track count IS the number of columns present, so there is no `count`
    // prop to drift out of step with the tree. Clamped because CSS only defines
    // tracks up to four, and a document can arrive from an imported theme.
    const tracks = Math.min(Math.max(Children.count(children), 1), 4);
    return (
      <div className={`nv-columns nv-columns--${tracks} nv-columns--gap-${props.gap}`}>
        {children}
      </div>
    );
  },
});

registerBlock({
  type:      "column",
  schema:    blockPropSchemas.column,
  container: true,
  // Placeable only inside a row, which is also why it never appears in a
  // region's block picker.
  editorMeta: { label: "Column", category: "structure", onlyInside: ["columns"] },
  // The track carries its own share, because a flex/grid parent cannot read its
  // children's props to size them.
  component: ({ props, children }) => (
    <div className={`nv-column nv-column--${props.width}${props.sticky ? " is-sticky" : ""}`}>
      {children}
    </div>
  ),
});

registerBlock({
  type:      "spacer",
  schema:    blockPropSchemas.spacer,
  editorMeta: { label: "Spacer", category: "structure" },
  component: ({ props }) => <div className={`nv-spacer nv-spacer--${props.size}`} aria-hidden="true" />,
});

// ── Content ─────────────────────────────────────────────────────────────────

function HeadingBlock({ props }: BlockProps<{ text: LocalizedText; eyebrow?: LocalizedText; level: 1 | 2 | 3; align: "start" | "center"; icon?: string }>) {
  const text    = useText(props.text);
  const eyebrow = useText(props.eyebrow);
  const Tag = (`h${props.level}`) as "h1" | "h2" | "h3";
  return (
    <header className={`nv-heading nv-heading--${props.align}`}>
      {eyebrow && <div className="nv-heading__eyebrow">{eyebrow}</div>}
      <Tag className="nv-heading__title">
        {/* ⚠ `TokenIcon` renders nothing at all when the prop is absent or cannot be
            drawn, so a heading without one is unchanged down to the markup. */}
        {props.icon && <TokenIcon token={props.icon} className="nv-heading__icon" />}
        {text}
      </Tag>
    </header>
  );
}

function EyebrowBlock({ props }: BlockProps<{ text: LocalizedText; align: "start" | "center" }>) {
  const text = useText(props.text);
  if (!text) return null;
  return <div className={`nv-eyebrow nv-eyebrow--${props.align}`}>{text}</div>;
}

registerBlock({
  type:   "eyebrow",
  schema: blockPropSchemas.eyebrow,
  editorMeta: { label: "Eyebrow label", category: "content" },
  component: EyebrowBlock,
});

registerBlock({
  type:   "heading",
  schema: blockPropSchemas.heading,
  editorMeta: { label: "Heading", category: "content" },
  component: HeadingBlock,
});

registerBlock({
  type:   "richText",
  schema: blockPropSchemas.richText,
  editorMeta: { label: "Rich text", category: "content" },
  // Same stored shape and renderer as `articles.body`, so a layout's prose and
  // an article's prose can never drift in how marks are rendered.
  component: ({ props }) => <div className="nv-richtext"><ArticleContent body={props.content} /></div>,
});

/**
 * An admin-supplied image reference → a usable src.
 *
 * Absolute URLs and rooted paths pass through; anything else is an upload path. Shared
 * so every block that takes an image resolves it identically.
 */
export function resolveImageSource(source: string): string {
  return source.startsWith("http") || source.startsWith("/") ? source : `/uploads/${source}`;
}

function ImageBlock({
  props,
}: BlockProps<{ source: string; alt?: LocalizedText; ratio: string; href?: string }>) {
  const alt = useText(props.alt);
  const src = resolveImageSource(props.source);
  const img = <img src={src} alt={alt} loading="lazy" />;
  return (
    <figure className={`nv-image nv-image--${props.ratio.replace(":", "x")}`}>
      {/* A linked image is how an image navbar is built: `columns` → `column` →
          `image{source, href, className}` per tile, with the look in custom CSS.
          `rel` is unconditional rather than computed from the origin — it costs
          nothing on an internal link and is the failure that matters on an
          external one. The scheme was already refused by `linkHrefSchema`. */}
      {props.href
        ? <a className="nv-image__link" href={props.href} rel="noopener noreferrer">{img}</a>
        : img}
    </figure>
  );
}

registerBlock({
  type:   "image",
  schema: blockPropSchemas.image,
  editorMeta: { label: "Image", category: "content" },
  component: ImageBlock,
});

// ── Plugin compatibility ────────────────────────────────────────────────────

registerBlock({
  type:   "pluginSlot",
  schema: blockPropSchemas.pluginSlot,
  editorMeta: { label: "Plugin area", category: "plugin" },
  // Not optional. Plugins render through slotRegistry, so without a block that
  // places those outlets, activating a custom layout would silently remove the
  // forum, shoutbox or messaging UI.
  //
  // Skips any widget the document ALSO places on its own — every layout widget is a
  // block now (`layout/slotBlocks.tsx`), and rendering it here too would show it
  // twice. The document comes from context so this reflects what is actually on
  // screen, including the editor's unsaved preview.
  component: ({ props }) => {
    const doc = useRenderedDocument();
    const placed = individuallyPlacedSlotIds(doc ? blockTypesIn(doc) : [], "layoutWidget");
    return <LayoutWidgetOutlet outlet={props.slotId} skipIds={placed} />;
  },
});

// ── Data-bound ──────────────────────────────────────────────────────────────

registerBlock({
  type:   "articleIndex",
  schema: blockPropSchemas.articleIndex,
  editorMeta: { label: "Article index", category: "data", allowedTemplates: ["article.index"], wide: true },
  component: ArticleIndexBlock,
});
