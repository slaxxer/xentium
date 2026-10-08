/**
 * One-time carry-over to the composed header and footer.
 *
 * The header became a container: a masthead holding the logo and an action group
 * (search, plugin icons, the bell, the admin link, the account menu), with the navbar
 * below it. The footer's bottom row became one `footerBar`: the copyright on one side,
 * the links on the other.
 *
 * Stored documents predate both. Without this they keep rendering the old way (the
 * masthead's built-in logo, every button in the navbar, the old branding row), so the
 * header and footer an admin edits would not be the ones the design describes.
 *
 * The moderation tool (ModCanvas shield) used to be drawn by the `notifications` block,
 * beside the bell. It is its own block now (`modTool`), and a header that does not
 * place one gets it inserted just before its bell, carrying the bell's audience,
 * alignment and style variant, so the two show as separate icons. The renderer still
 * draws the shield from the bell for any document this never reached.
 *
 * Every theme's rows, every scope. Flag-guarded and non-destructive in the ways that
 * matter: an account button is MOVED, never dropped (the account menu is required);
 * a masthead that already holds actions is left as arranged.
 */
import { DEFAULT_LAYOUTS, layoutDocumentSchema, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

// v2: the footer's bottom row became one `footerBar` (2026-10-02).
// v3: the moderation tool split out of the bell into its own block (2026-10-06).
export const COMPOSED_CHROME_MIGRATED = "layout.composedChromeMigrated.v3";

/** What the masthead's action group holds, in the order the design draws it. */
const ACTION_TYPES = ["modTool", "notifications", "headerWidgets", "adminLink", "userMenu", "search"];

const stripThemeToggle = (nodes: BlockNode[]): BlockNode[] =>
  nodes.filter((n) => n.type !== "themeToggle")
    .map((n) => (n.children ? { ...n, children: stripThemeToggle(n.children) } : n));

/** Content equality, whatever the key order (jsonb reorders keys). */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
    : x
));

/** The header every site shipped with before the composed header, as stored. */
const OLD_DEFAULT_HEADER: BlockNode[] = [
  { id: "h-band", type: "header", props: {
    height: 250, showLogo: true, showWordmark: true,
    backgroundGradient: ["#2b1055", "#7597de"], backgroundAngle: 90,
  } },
  { id: "h-navbar", type: "navbar", props: {}, children: [
    { id: "h-logo", type: "logo", props: { showWordmark: true } },
    { id: "h-nav", type: "navLinks", props: {} },
    { id: "h-search", type: "search", props: { expanded: false }, align: "right" },
    { id: "h-widgets", type: "headerWidgets", props: {}, align: "right" },
    { id: "h-notif", type: "notifications", props: {}, align: "right" },
    { id: "h-admin", type: "adminLink", props: {}, align: "right" },
    { id: "h-user", type: "userMenu", props: {}, align: "right" },
  ] },
];

const placesModTool = (nodes: BlockNode[]): boolean =>
  nodes.some((n) => n.type === "modTool" || (!!n.children && placesModTool(n.children)));

const allIds = (nodes: BlockNode[], into = new Set<string>()): Set<string> => {
  for (const n of nodes) { into.add(n.id); if (n.children) allIds(n.children, into); }
  return into;
};

/**
 * Put a `modTool` block just before the first bell, unless the document already places
 * one. Mutates `region`; returns whether it changed.
 *
 * The shipped default's bell (`h-notif`) gets the shipped default's id (`h-mod`), so an
 * untouched header comes out EQUAL to today's default rather than customised for ever.
 */
export function splitModTool(region: BlockNode[]): boolean {
  if (placesModTool(region)) return false;
  const ids = allIds(region);

  const insert = (nodes: BlockNode[]): boolean => {
    const at = nodes.findIndex((n) => n.type === "notifications");
    if (at >= 0) {
      const bell = nodes[at]!;
      let id = bell.id === "h-notif" ? "h-mod" : `${bell.id}-mod`;
      for (let i = 2; ids.has(id); i++) id = `${bell.id}-mod${i}`;
      // Everything that says WHERE and FOR WHOM the bell shows; never its children or props.
      const { id: _id, type: _type, props: _props, children: _children, ...placement } = bell;
      nodes.splice(at, 0, { id, type: "modTool", props: {}, ...placement });
      return true;
    }
    return nodes.some((n) => !!n.children && insert(n.children));
  };
  return insert(region);
}

/** The header document in the composed shape, or null when it already is. */
export function composeHeader(doc: LayoutDocument): LayoutDocument | null {
  /*
   * A header nobody touched becomes today's default EXACTLY — the design's masthead
   * and navbar — or it would compare unequal to the code default and read as
   * customised for ever.
   */
  if (stable(stripThemeToggle(doc.regions.header ?? [])) === stable(OLD_DEFAULT_HEADER)) {
    return structuredClone(DEFAULT_LAYOUTS["chrome.header"]);
  }
  const next = structuredClone(doc);
  const region = (next.regions.header ?? []);
  let changed = false;

  const stripped = stripThemeToggle(region);
  if (JSON.stringify(stripped) !== JSON.stringify(region)) changed = true;
  next.regions.header = stripped;

  const header = stripped.find((n) => n.type === "header");
  const navbar = stripped.find((n) => n.type === "navbar");
  if (!header) return splitModTool(stripped) || changed ? next : null;

  const props = header.props as { showLogo?: boolean; showWordmark?: boolean };
  header.children ??= [];
  if (!header.children.some((c) => c.type === "logo") && props.showLogo !== false) {
    header.children.unshift({
      id: `${header.id}-logo`, type: "logo", props: { showWordmark: props.showWordmark !== false },
    });
    header.props = { ...header.props, showLogo: false };
    changed = true;
  }

  const hasActions = header.children.some((c) => ACTION_TYPES.includes(c.type));
  if (!hasActions && navbar?.children?.length) {
    const moving = navbar.children.filter((c) => ACTION_TYPES.includes(c.type));
    if (moving.length) {
      navbar.children = navbar.children.filter((c) => !ACTION_TYPES.includes(c.type));
      moving.sort((a, b) => ACTION_TYPES.indexOf(a.type) - ACTION_TYPES.indexOf(b.type));
      // Alignment is a navbar concept; inside the masthead group it means nothing.
      header.children.push(...moving.map(({ align: _align, ...n }) => n));
      changed = true;
    }
  }
  if (splitModTool(stripped)) changed = true;
  return changed ? next : null;
}

/**
 * The footer document with its bottom row as ONE `footerBar`, or null when it already is.
 *
 * Two older shapes come in: `branding` (links + copyright in one block), and the
 * short-lived `footerLinks` + `footerText` pair with the alignment/order settings on
 * the footer block. Both become a `footerBar` in the first one's place.
 */
export function composeFooter(doc: LayoutDocument): LayoutDocument | null {
  const next = structuredClone(doc);
  let changed = false;

  const visit = (nodes: BlockNode[], parent: BlockNode | null): BlockNode[] => {
    const out: BlockNode[] = [];
    let pending: { links?: BlockNode; text?: BlockNode; at: number } | null = null;
    for (const n of nodes) {
      if (n.children) n.children = visit(n.children, n);
      if (n.type === "branding") {
        changed = true;
        const p = n.props as { showUptime?: boolean; showThemeChooser?: boolean };
        // The shipped default's branding becomes the shipped default's bar EXACTLY,
        // or an untouched site would read as customised for ever.
        const untouched = n.id === "f-brand" && p.showUptime !== false && p.showThemeChooser !== false;
        out.push(untouched
          ? { id: "f-bar", type: "footerBar", props: {} }
          : { id: `${n.id}-bar`, type: "footerBar", props: {
              showUptime: p.showUptime !== false, showThemeChooser: p.showThemeChooser !== false,
            } });
        continue;
      }
      if (n.type === "footerLinks" || n.type === "footerText") {
        changed = true;
        pending ??= { at: out.length };
        pending[n.type === "footerLinks" ? "links" : "text"] = n;
        continue;
      }
      out.push(n);
    }
    if (pending) {
      const links = (pending.links?.props ?? {}) as { showThemeChooser?: boolean };
      const text = (pending.text?.props ?? {}) as { showUptime?: boolean };
      // The bar has one arrangement (links + theme picker, copyright under them), so
      // the pair's alignment settings have nothing to carry over to.
      const props: Record<string, unknown> = {};
      if (text.showUptime) props.showUptime = true;
      if (links.showThemeChooser === false) props.showThemeChooser = false;
      const isDefault = pending.links?.id === "f-links" && pending.text?.id === "f-text";
      out.splice(pending.at, 0, { id: isDefault ? "f-bar" : `${(pending.links ?? pending.text)!.id}-bar`, type: "footerBar", props });
      if (parent?.type === "footer") {
        const { linksAlign: _l, textAlign: _t, order: _o, ...rest } = parent.props as Record<string, unknown>;
        parent.props = rest;
      }
    }
    return out;
  };
  for (const [region, nodes] of Object.entries(next.regions)) next.regions[region] = visit(nodes, null);
  return changed ? next : null;
}

/**
 * A package's documents with the header and footer composed — or null when neither
 * needed it. Also what a theme import runs, so a package built before the composed
 * header installs in the current shape.
 */
export function composeDocuments(documents: Record<string, unknown>): Record<string, unknown> | null {
  let changed = false;
  const out: Record<string, unknown> = { ...documents };
  for (const key of ["chrome.header", "chrome.footer"] as const) {
    const parsed = layoutDocumentSchema.safeParse(documents[key]);
    if (!parsed.success) continue;
    const next = key === "chrome.header" ? composeHeader(parsed.data) : composeFooter(parsed.data);
    if (next) { out[key] = next; changed = true; }
  }
  return changed ? out : null;
}

export async function migrateComposedChrome(): Promise<void> {
  if (await getSetting<boolean>(COMPOSED_CHROME_MIGRATED, false)) return;

  const rows = await prisma.layout.findMany({
    where:  { templateKey: { in: ["chrome.header", "chrome.footer"] } },
    select: { id: true, templateKey: true, document: true },
  });

  let changed = 0;
  for (const row of rows) {
    const parsed = layoutDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;   // a document we cannot read is not one we can fix
    const next = row.templateKey === "chrome.header" ? composeHeader(parsed.data) : composeFooter(parsed.data);
    if (!next) continue;
    await prisma.layout.update({ where: { id: row.id }, data: { document: next as unknown as object } });
    changed++;
  }

  // The installed themes' packages too: a theme that never had its header edited
  // renders straight from its package, so its stored copy has to be in the new shape.
  const themes = await prisma.theme.findMany({ select: { id: true, payload: true } });
  for (const theme of themes) {
    const payload = theme.payload as { documents?: Record<string, unknown> } | null;
    const composed = composeDocuments(payload?.documents ?? {});
    if (!composed) continue;
    await prisma.theme.update({ where: { id: theme.id }, data: { payload: { ...payload, documents: composed } as object } });
    changed++;
  }

  await prisma.setting.upsert({
    where:  { key: COMPOSED_CHROME_MIGRATED },
    update: { value: true },
    create: { key: COMPOSED_CHROME_MIGRATED, value: true },
  });
  bustSettingsCache(COMPOSED_CHROME_MIGRATED);
  if (changed) logger.info({ changed }, "Header and footer carried over to the composed layout");
}
