/**
 * Background and image helpers shared by every block that takes a picture or a
 * gradient — and by the sign-in pages, which wear the masthead's background. Kept
 * free of block registrations so anything can import them without pulling in (or
 * cycling back through) the block library.
 */

/**
 * An admin-supplied image reference → a usable src.
 *
 * Absolute URLs and rooted paths pass through; anything else is an upload path. Shared
 * so every block that takes an image resolves it identically.
 */
export function resolveImageSource(source: string): string {
  return source.startsWith("http") || source.startsWith("/") ? source : `/uploads/${source}`;
}

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
 * input, so the guarantee has to live in the schema where a `.xttheme` import hits
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
