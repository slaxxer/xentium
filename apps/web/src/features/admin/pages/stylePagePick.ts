/**
 * Click-to-style on a REAL page (Theme Studio → Colours & type → Page preview).
 *
 * The Components preview is a specimen built for the editor: every surface carries a
 * `data-component` and sits in a `data-region`. A real page carries neither, so a
 * click is read off what the site itself renders: the nearest component it is part of
 * (a button, a field, a card, a header dropdown, the account pill) and the nearest
 * SCOPE around it, using the same selectors the served stylesheet scopes tokens with
 * (`SCOPE_SELECTOR`) — a block's style variant or the region it sits in.
 *
 * The answer is `[section, scope]` for the editor's `onPick`, the same pair the
 * specimen produces, so both previews drive one inspector.
 */
import { SCOPE_SELECTOR } from "@xentium/contracts";

/** The header's action pill (the "User menu" section). */
export const PILL = ".xt-header__actions";

/** Scopes in the order they are tested on each ancestor; `global` is the fallback. */
const SCOPES = Object.entries(SCOPE_SELECTOR).filter(([s]) => s !== "global") as [string, string][];

const REGION_SCOPES = new Set(["navbar", "content", "footer", "aside"]);

/** The nearest scope around `el`: the innermost ancestor matching a scope selector. */
export function scopeOf(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    for (const [scope, selector] of SCOPES) {
      try { if (n.matches(selector)) return scope; } catch { /* a selector this DOM cannot parse */ }
    }
  }
  return "global";
}

/** The component `el` belongs to, by what the site renders. */
export function componentOf(el: Element): string | null {
  // A dropdown is a Menu; the pill it opens from is the User menu. Dropdown first: it
  // renders INSIDE the pill.
  if (el.closest(".xt-pop")) return "menu";
  // A field before the pill: the header search sits inside it and is a Field.
  if (el.closest("input, select, textarea")) return "field";
  if (el.closest(PILL)) return "usermenu";
  if (el.closest("button, .btn, [class^='btn-'], [class*=' btn-']")) return "button";
  if (el.closest("[class*='card']")) return "card";
  return null;
}

/**
 * `[section, scope]` for a click at `el`.
 *
 * - On a component: that component, in the scope around it.
 * - Inside a region and nothing more specific: the region's own section.
 * - Inside a style variant: Card, scoped to the variant — every variant aliases the
 *   card colours to its surface set, so that is where a section's background lives.
 * - Anywhere else: the palette.
 */
export function pickOnPage(el: Element): [string, string] {
  const scope = scopeOf(el);
  const component = componentOf(el);
  // The masthead's dropdowns and pill are global-only: no region scope reaches them.
  if (component === "menu" || component === "usermenu") return [component, "global"];
  if (component) return [component, scope];
  if (REGION_SCOPES.has(scope)) return [scope, "global"];
  if (scope.startsWith("variant.")) return ["card", scope];
  return ["palette", "global"];
}
