/**
 * The composer's tool set — the one list the editor and the ACP page both read.
 *
 * ⚠ It lives in contracts, not in the web app, because an ADMIN decides which tools
 * reach the action bar and that decision is stored server-side. Two copies of this
 * list would drift the moment a tool is added, and the drift would look like an
 * admin's setting silently doing nothing.
 */

/** Every tool the composer can offer. Order here is the order they are presented. */
export const COMPOSER_TOOL_IDS = [
  // Marks
  "bold", "italic", "underline", "strike", "highlight", "subscript", "superscript",
  // Blocks
  "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "inlineCode", "divider",
  // Align
  "alignLeft", "alignCenter", "alignRight", "alignJustify",
  // Insert & history
  "link", "attach", "emoji", "mention", "undo", "redo",
] as const;

export type ComposerToolId = typeof COMPOSER_TOOL_IDS[number];

/** Which drawer of the overflow tray a tool belongs to. */
export type ComposerToolGroup = "marks" | "blocks" | "align" | "insert";

export const COMPOSER_TOOL_GROUP: Record<ComposerToolId, ComposerToolGroup> = {
  bold: "marks", italic: "marks", underline: "marks", strike: "marks",
  highlight: "marks", subscript: "marks", superscript: "marks",

  bulletList: "blocks", orderedList: "blocks", taskList: "blocks",
  blockquote: "blocks", codeBlock: "blocks", inlineCode: "blocks", divider: "blocks",

  alignLeft: "align", alignCenter: "align", alignRight: "align", alignJustify: "align",

  link: "insert", attach: "insert", emoji: "insert", mention: "insert",
  undo: "insert", redo: "insert",
};

/** Where a tool sits. Everything not in the bar and not off is in the overflow tray. */
export type ComposerPlacement = "bar" | "overflow" | "off";

export interface ComposerConfig {
  /**
   * The action bar, IN ORDER. Six is the design's number and what fits a phone row
   * without scrolling, but the length is the admin's to choose.
   *
   * ⚠ A tool listed here and also in `off` is off: `resolveComposerConfig` treats
   * `off` as the final word, so the two lists cannot contradict each other.
   */
  bar: ComposerToolId[];
  /** Tools an admin has switched off entirely — absent from bar AND tray. */
  off: ComposerToolId[];
  /** @ mentions on every surface, not just article comments. */
  mentions: boolean;
}

/**
 * The six that cover most posts, per the redesign: bold, italic, link, list, attach,
 * emoji. Everything else starts in the overflow tray rather than switched off — a
 * fresh install should hide nothing, only demote.
 */
export const COMPOSER_DEFAULT_CONFIG: ComposerConfig = {
  bar: ["bold", "italic", "link", "bulletList", "attach", "emoji"],
  off: [],
  mentions: true,
};

/** One tool, resolved: what it is and where it goes. */
export interface ResolvedComposerTool {
  id:    ComposerToolId;
  group: ComposerToolGroup;
  where: ComposerPlacement;
}

/**
 * Turn a stored (or partial, or hand-edited) config into the full picture.
 *
 * ⚠ Defensive on purpose. This value is a settings row: it survives backup
 * restores, hand edits and older versions of this list, so an unknown id is dropped
 * and a tool nobody mentioned lands in the tray. The editor must never be left with
 * a bar it cannot render.
 */
export function resolveComposerConfig(raw: unknown): {
  config: ComposerConfig;
  tools:  ResolvedComposerTool[];
} {
  const known = new Set<string>(COMPOSER_TOOL_IDS);
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<ComposerConfig>;

  const clean = (list: unknown): ComposerToolId[] => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.filter((id): id is ComposerToolId => {
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const off = clean(input.off);
  const offSet = new Set<string>(off);
  // `off` wins: a tool an admin switched off must not come back by being in the bar.
  const bar = clean(input.bar).filter((id) => !offSet.has(id));
  const barSet = new Set<string>(bar);

  const tools: ResolvedComposerTool[] = COMPOSER_TOOL_IDS.map((id) => ({
    id,
    group: COMPOSER_TOOL_GROUP[id],
    where: offSet.has(id) ? "off" : barSet.has(id) ? "bar" : "overflow",
  }));

  return {
    config: {
      bar,
      off,
      mentions: typeof input.mentions === "boolean" ? input.mentions : true,
    },
    tools,
  };
}
