/**
 * An icon stored as DATA — a badge's glyph, a block's prop, anything an admin chose.
 *
 * Distinct from `components/Icon`, which restyles the icons core's own code names.
 * This one starts from a stored token and works out what can actually draw it.
 *
 * The chain, in order, and every step is a deliberate choice:
 *
 *   1. the token's PINNED style, if it has one and the kit has loaded;
 *   2. the SITE's style, if a kit has loaded;
 *   3. the BUNDLED free solid icon of that name;
 *   4. nothing.
 *
 * ⚠ Step 3 is why a site that loses its kit still looks finished rather than broken.
 * A pin is an admin's preference; the icon they chose is the thing that matters, and
 * the bundled set can still draw it as long as core ships that name.
 *
 * ⚠ What this CANNOT do is detect a glyph the kit does not have. In web-font mode a
 * missing glyph renders as nothing, silently, with no event to hook. That is why the
 * picker previews live — the preview is the only ground truth, and the Pro+ families
 * are exactly where it matters.
 */
import { FontAwesomeIcon as StyledIcon } from "./Icon";
import { parseIconToken, iconStyleClasses } from "@xentium/contracts";
import { bundledIcon } from "../lib/iconCatalogue";
import { useIconStyle, useIconKitReady } from "../lib/iconKit";
import { useIconScope } from "../lib/iconScope";

export interface TokenIconProps {
  /** `"star"` or `"jelly-regular:star"`. Legacy `"faStar"` is accepted. */
  token:      string | null | undefined;
  className?: string;
}

export function TokenIcon({ token, className }: TokenIconProps) {
  const siteStyle = useIconStyle();
  const scope     = useIconScope();
  // ⚠ In the ACP a pinned style is ignored too, not just the site's. An admin's
  // Jelly badge glyph must not put a missing-glyph box in the admin panel's own
  // list — the bundled icon still says which badge it is, which is the list's job.
  const kitReady  = useIconKitReady() && scope !== "acp";
  const parsed    = parseIconToken(token);
  if (!parsed) return null;

  const { style, name } = parsed;

  // 1 — a pin, honoured only once the kit can actually draw it.
  if (style && kitReady) {
    const classes = iconStyleClasses(style);
    // `iconStyleClasses` returns null for `solid`, which is the bundled set: a pin to
    // Solid is a pin to "the icons core ships", not a class to emit.
    if (classes) {
      return (
        <span
          className={className}
          dangerouslySetInnerHTML={{ __html: `<i class="${classes} fa-${name}"></i>` }}
        />
      );
    }
  }

  // 3 — the bundled definition. Reached whenever there is no kit, and whenever the
  // icon is unpinned (step 2 then happens inside `StyledIcon`, which applies the
  // site style to it without this component needing to know).
  const bundled = bundledIcon(name);
  if (bundled) return <StyledIcon icon={bundled} className={className} />;

  // 2 — unpinned, not bundled: the kit is the only thing that can draw it.
  if (!style && kitReady && siteStyle) {
    return (
      <span
        className={className}
        dangerouslySetInnerHTML={{ __html: `<i class="${siteStyle} fa-${name}"></i>` }}
      />
    );
  }
  if (!style && kitReady) {
    return (
      <span
        className={className}
        dangerouslySetInnerHTML={{ __html: `<i class="fa-solid fa-${name}"></i>` }}
      />
    );
  }

  // 4 — nothing. Not a broken box, not a missing-glyph square.
  return null;
}
