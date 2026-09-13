/**
 * `FontAwesomeIcon`, with the site's icon style applied.
 *
 * A DROP-IN for `@fortawesome/react-fontawesome`: same name, same props, same
 * `icon={faStar}` call. Every core file and every plugin imports this instead, so
 * one setting restyles the whole application without touching a single call site.
 *
 * ⚠ The call sites keep importing the FREE icon definitions, and that is the point.
 * Those imports are what still draws when there is no kit — which is the default
 * install, every install that never buys Pro, and any install whose kit is slow,
 * blocked or broken. Pro is a layer on top, never a dependency.
 *
 * ⚠ Pro ARTWORK is never bundled. We read only the icon's NAME out of the free
 * definition and hand that name to the admin's own kit as a class. See
 * `docs/icon-kits.md` for why that distinction is the whole design.
 */
import { FontAwesomeIcon as FaIcon } from "@fortawesome/react-fontawesome";
import type { FontAwesomeIconProps } from "@fortawesome/react-fontawesome";
import { useIconStyle } from "../lib/iconKit";
import { useIconScope } from "../lib/iconScope";
import { useIconSlotScope, useIconSlot } from "../layout/iconSlots";
import { bundledIcon } from "../lib/iconCatalogue";
import { parseIconToken, iconStyleClasses } from "@xentium/contracts";
import { isEditorPreview } from "../layout/previewMode";

/** Props we translate into kit classes. Everything else falls back to the free set. */
const SPIN_CLASS = "fa-spin";

/**
 * Read the icon's name out of whatever was passed.
 *
 * ⚠ Returns null for anything that is not a plain definition object — an array
 * (`["fas","star"]`), a bare string, a lookup that came back undefined. Those go to
 * the real component untouched rather than being guessed at.
 */
function iconNameOf(icon: FontAwesomeIconProps["icon"]): string | null {
  if (!icon || typeof icon !== "object" || Array.isArray(icon)) return null;
  const name = (icon as { iconName?: unknown }).iconName;
  return typeof name === "string" && /^[a-z0-9-]{1,60}$/.test(name) ? name : null;
}

export function FontAwesomeIcon(props: FontAwesomeIconProps) {
  const siteStyle = useIconStyle();
  const scope     = useIconScope();
  const slotScope = useIconSlotScope();

  // ⚠ The ACP keeps the bundled free set, always. See `lib/iconScope`.
  const inAcp = scope === "acp";
  const ownName = iconNameOf(props.icon);

  /**
   * ⚠ Claimed UNCONDITIONALLY, before any early return — a hook cannot be
   * conditional, and nor can the numbering: if an icon skipped its claim because a
   * style or a scope sent it down another path, every override below it would slide
   * onto a neighbour.
   */
  const slot = useIconSlot(slotScope, ownName);

  // The editor needs to address this exact icon; the live site does not, and stamping
  // a data attribute on every icon of a real page would be noise.
  const mark = isEditorPreview() && slot
    ? { "data-nv-icon": `${slotScope!.blockId}::${slot.key}` }
    : {};

  /**
   * An override REPLACES the icon the code asked for.
   *
   * ⚠ If it cannot be drawn — a kit-only name with no kit, a glyph the family lacks —
   * we fall through to the original icon rather than to nothing. A hole where a
   * control used to be is worse than the wrong-but-present icon, and the admin who
   * set it sees the truth in the picker's preview.
   */
  const override = slot?.override ? parseIconToken(slot.override) : null;
  if (override && !inAcp) {
    const classes = override.style ? iconStyleClasses(override.style) : siteStyle;
    if (classes) {
      const oc = [classes, `fa-${override.name}`, props.spin ? SPIN_CLASS : null, props.className]
        .filter(Boolean).join(" ");
      return (
        <span
          style={props.style}
          {...mark}
          dangerouslySetInnerHTML={{ __html: `<i class="${oc}"></i>` }}
        />
      );
    }
    const bundled = bundledIcon(override.name);
    if (bundled) return <FaIcon {...props} icon={bundled} {...mark} />;
  }

  const styleClasses = inAcp ? null : siteStyle;
  const name = styleClasses ? ownName : null;

  // No kit, no style, or an icon we cannot name: draw exactly what we always drew.
  if (!styleClasses || !name) return <FaIcon {...props} {...mark} />;

  const cls = [styleClasses, `fa-${name}`, props.spin ? SPIN_CLASS : null, props.className]
    .filter(Boolean)
    .join(" ");

  /**
   * ⚠ The `<i>` is written as raw HTML so REACT NEVER OWNS IT.
   *
   * A kit in SVG mode replaces every `fa-` element with an `<svg>` of its own. Had
   * React rendered this `<i>`, it would still hold a reference to a node no longer
   * in the tree, and unmounting would throw `NotFoundError` on a child FontAwesome
   * had already swapped out. An opaque wrapper sidesteps that entirely and works
   * whether the admin's kit is in SVG or web-font mode.
   *
   * ⚠ `cls` is built from a validated icon name and a fixed style list, never from
   * free text — this string is markup.
   */
  return (
    <span
      style={props.style}
      {...mark}
      dangerouslySetInnerHTML={{ __html: `<i class="${cls}"></i>` }}
    />
  );
}

export type { FontAwesomeIconProps };
