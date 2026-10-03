/**
 * The site frame: how the whole page sits in the browser window.
 *
 * `full` is the only layout Xentium had before this existed: the page fills the
 * window. The other modes put the site, or parts of it, in a centred box with a body
 * background showing around it. It is a THEME-level setting, which is why it travels
 * in a `.xttheme` and why the Layout Editor offers "Revert to theme".
 *
 * Stored as ONE document, next to the layouts it frames (`xcf_layouts`, under
 * `SITE_FRAME_ROW_KEY`), so it gets the same draft, publish, theme baseline and
 * theme undo that a layout gets, without a second staging system beside the first.
 *
 * The per-page overrides live INSIDE this document rather than on each page's own
 * layout. The Layout Editor has one page's document open and autosaves it; a frame
 * choice written into six different documents from one popover would race that
 * autosave on whichever page happened to be open.
 */
import { z } from 'zod';
import { cssColorSchema } from './layout.js';

export const FRAME_MODES = ['full', 'boxed', 'flush', 'framed', 'floating', 'overlap'] as const;
export type FrameMode = (typeof FRAME_MODES)[number];

/**
 * The pages that may wear their own frame. Core page templates only: the chrome is
 * not a page, and a plugin page follows the site default.
 */
export const FRAME_PAGE_TEMPLATES = [
  'home', 'article.index', 'article.detail', 'profile', 'members',
] as const;
export type FramePageTemplate = (typeof FRAME_PAGE_TEMPLATES)[number];

export const FRAME_SHADOWS = ['none', 'soft', 'lifted'] as const;
export const FRAME_BACKGROUNDS = ['color', 'gradient', 'image'] as const;
export const FRAME_PHONE = ['edge', 'keep'] as const;

/**
 * The key the frame's rows are stored under in `xcf_layouts`.
 *
 * ⚠ Chosen to FAIL `templateKeySchema`, so it can never collide with a template a
 * plugin registers, and so every migration that walks the table and `safeParse`s a
 * layout document skips this row instead of trying to fix it.
 */
export const SITE_FRAME_ROW_KEY = '@site-frame';

/** The ranges the editor's sliders offer. The schema's, so an import cannot exceed them. */
export const FRAME_LIMITS = {
  maxWidth: { min: 960, max: 1600, step: 20 },
  radius:   { min: 0, max: 32, step: 1 },
  overlap:  { min: 80, max: 320, step: 10 },
  angle:    { min: 0, max: 355, step: 5 },
} as const;

export const siteFrameBackgroundSchema = z.object({
  type:   z.enum(FRAME_BACKGROUNDS).default('gradient'),
  color:  cssColorSchema.default('#1b1e36'),
  /** Two or three stops. `var(--c-*)` is allowed, and is what a theme should use. */
  stops:  z.array(cssColorSchema).min(2).max(3).default(['#14162a', '#5865f2']),
  angle:  z.number().int().min(0).max(360).default(150),
  radial: z.boolean().default(false),
  /**
   * An upload path (`layouts/bg.jpg`). Empty = none, and the gradient shows until an
   * image is picked. A relative upload path is what the theme exporter copies into
   * the package, exactly as it does a section background.
   */
  image:  z.string().max(500).default(''),
  /** The page slides over a still background. */
  fixed:  z.boolean().default(true),
});

export const siteFrameSchema = z.object({
  mode:      z.enum(FRAME_MODES).default('full'),
  maxWidth:  z.number().int().min(FRAME_LIMITS.maxWidth.min).max(FRAME_LIMITS.maxWidth.max).default(1280),
  radius:    z.number().int().min(FRAME_LIMITS.radius.min).max(FRAME_LIMITS.radius.max).default(18),
  shadow:    z.enum(FRAME_SHADOWS).default('soft'),
  /** How far the page box rises into the masthead band, `overlap` mode only. */
  overlap:   z.number().int().min(FRAME_LIMITS.overlap.min).max(FRAME_LIMITS.overlap.max).default(200),
  background: siteFrameBackgroundSchema.default(() => siteFrameBackgroundSchema.parse({})),
  /** Below 640px: drop the frame (`edge`) or keep it with a smaller gap (`keep`). */
  phone:     z.enum(FRAME_PHONE).default('edge'),
  /**
   * Pages wearing their own frame. Absent = the site default.
   *
   * ⚠ A page on the default has NO key, never an empty string: pending status is a
   * stringify, and `{home: ''}` beside `{}` would read as a change nobody made.
   */
  overrides: z.partialRecord(z.enum(FRAME_PAGE_TEMPLATES), z.enum(FRAME_MODES)).default({}),
});

export type SiteFrame = z.infer<typeof siteFrameSchema>;
export type SiteFrameBackground = z.infer<typeof siteFrameBackgroundSchema>;

/**
 * Drop override keys for pages that no longer exist (`page.detail`, removed with
 * custom pages). The record's keys are an enum, so one stale key would fail the
 * WHOLE frame and silently reset every setting in it to the default.
 */
function dropRetiredOverrides(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const overrides = (raw as { overrides?: unknown }).overrides;
  if (!overrides || typeof overrides !== 'object') return raw;
  const kept = Object.fromEntries(
    Object.entries(overrides).filter(([k]) => (FRAME_PAGE_TEMPLATES as readonly string[]).includes(k)),
  );
  return { ...raw, overrides: kept };
}

/**
 * Parse a stored or received frame, falling back to the default.
 *
 * Every comparison of two frames is a `JSON.stringify`, and Zod emits keys in SCHEMA
 * order, so both sides must come through here or an untouched frame reads as changed.
 */
export function parseSiteFrame(raw: unknown): SiteFrame {
  const parsed = siteFrameSchema.safeParse(dropRetiredOverrides(raw ?? {}));
  return parsed.success ? parsed.data : siteFrameSchema.parse({});
}

export const DEFAULT_SITE_FRAME: SiteFrame = siteFrameSchema.parse({});

/** The mode a page actually wears: its own override, else the site default. */
export function frameModeFor(frame: SiteFrame, templateKey: string | null | undefined): FrameMode {
  const own = templateKey ? frame.overrides[templateKey as FramePageTemplate] : undefined;
  return own ?? frame.mode;
}

/**
 * The body background as a CSS `background-image` value.
 *
 * A flat colour is written as a one-colour gradient so all three types are the same
 * CSS property: switching type never leaves a stale `background-color` underneath.
 * The image goes over the gradient, so an image with transparency, or one still
 * loading, sits on the gradient rather than on nothing.
 *
 * Values are safe to interpolate: every colour passed `cssColorSchema`, and the image
 * path is quoted with `"` and `\` escaped.
 */
export function frameBackgroundCss(bg: SiteFrameBackground, imageUrl?: string): string {
  if (bg.type === 'color') return `linear-gradient(${bg.color}, ${bg.color})`;
  const n = bg.stops.length;
  const stops = bg.stops.map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`).join(', ');
  const gradient = bg.radial
    ? `radial-gradient(circle at center, ${stops})`
    : `linear-gradient(${bg.angle}deg, ${stops})`;
  if (bg.type === 'image' && imageUrl) {
    return `url("${imageUrl.replace(/["\\]/g, '\\$&')}"), ${gradient}`;
  }
  return gradient;
}
