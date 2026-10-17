/**
 * Ready-made arrangements for the site header and footer: one click instead of
 * building the chrome from blocks.
 *
 * A preset changes the ARRANGEMENT and keeps the site's look: the band's colours,
 * picture and height, the navbar's colour, height and stickiness, the footer's
 * background and its bar's options all carry over from what is there now. It does
 * replace the region's blocks, so an extra block an admin added to the header is
 * not kept; the editor's undo brings it back.
 */
import { DEFAULT_LAYOUTS, type BlockNode } from "@xentium/contracts";

type Regions = Record<string, BlockNode[]>;

export type HeaderPresetId = "row" | "below" | "above" | "centred";
export type FooterPresetId = "full" | "community" | "minimal";

export const HEADER_PRESETS: HeaderPresetId[] = ["below", "row", "above", "centred"];
export const FOOTER_PRESETS: FooterPresetId[] = ["full", "community", "minimal"];

const clone = <T,>(v: T): T => structuredClone(v);

function find(nodes: BlockNode[] | undefined, type: string): BlockNode | undefined {
  for (const n of nodes ?? []) {
    if (n.type === type) return n;
    const hit = find(n.children, type);
    if (hit) return hit;
  }
  return undefined;
}

/** Props of `from` that describe how a block LOOKS, copied onto `to`. */
function carry(to: BlockNode | undefined, from: BlockNode | undefined, keys: string[]) {
  if (!to || !from) return;
  for (const k of keys) {
    if (from.props[k] !== undefined) to.props[k] = from.props[k];
  }
}

const BAND_LOOK = ["height", "backgroundImage", "backgroundGradient", "backgroundAngle", "backgroundMode", "showTagline"];
const NAV_LOOK = ["sticky", "height", "tone", "accountAlign"];
const FOOT_LOOK = ["minHeight", "backgroundImage", "backgroundGradient", "backgroundAngle", "showTopBorder"];

/** The header region arranged as `preset`, keeping the current look. */
export function headerPreset(current: Regions, preset: HeaderPresetId): Regions {
  const base = clone(DEFAULT_LAYOUTS["chrome.header"].regions.header ?? []);
  const navbar = base.find((n) => n.type === "navbar")!;
  const band = base.find((n) => n.type === "header")!;
  const now = current.header ?? [];
  carry(band, find(now, "header"), BAND_LOOK);
  carry(navbar, find(now, "navbar"), NAV_LOOK);

  const links = navbar.children!.find((c) => c.type === "navLinks")!;
  switch (preset) {
    case "below":
      // The core look: navbar on top with logo, links and the account menu; the
      // band under it.
      return { header: [navbar, band] };
    case "row":
      // One row: no band. The navbar carries the account menu the band would hold.
      band.props.showMasthead = false;
      return { header: [band, navbar] };
    case "above":
      // The band on top with the logo and the account buttons; the links below.
      band.props.showButtons = true;
      navbar.children = [links];
      return { header: [band, navbar] };
    case "centred":
      // A centred logo in the band, the links centred under it, account in the band.
      band.props.showButtons = true;
      band.props.logoAlign = "center";
      links.align = "center";
      navbar.children = [links];
      return { header: [band, navbar] };
  }
}

/** The footer region arranged as `preset`, keeping the current look. */
export function footerPreset(current: Regions, preset: FooterPresetId): Regions {
  const base = clone(DEFAULT_LAYOUTS["chrome.footer"].regions.footer ?? []);
  const band = base.find((n) => n.type === "footer")!;
  const now = current.footer ?? [];
  carry(band, find(now, "footer"), FOOT_LOOK);
  carry(find(band.children, "footerBar"), find(now, "footerBar"), ["showUptime", "showThemeChooser"]);
  carry(find(band.children, "whosOnline"), find(now, "whosOnline"), ["maxNames"]);

  const keep: Record<FooterPresetId, string[]> = {
    full:      ["whosOnline", "groupLegend", "boardStats", "footerBar"],
    community: ["whosOnline", "boardStats", "footerBar"],
    minimal:   ["footerBar"],
  };
  band.children = (band.children ?? []).filter((c) => keep[preset].includes(c.type));
  return { footer: [band] };
}

/** Which preset the current arrangement IS, if any — the card shown as chosen. */
export function activeHeaderPreset(current: Regions): HeaderPresetId | null {
  const same = JSON.stringify(current.header ?? []);
  return HEADER_PRESETS.find((p) => JSON.stringify(headerPreset(current, p).header) === same) ?? null;
}

export function activeFooterPreset(current: Regions): FooterPresetId | null {
  const same = JSON.stringify(current.footer ?? []);
  return FOOTER_PRESETS.find((p) => JSON.stringify(footerPreset(current, p).footer) === same) ?? null;
}
