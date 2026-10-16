/**
 * THE BLOCK LIBRARY — the rail's "Blocks" tab, the editor's main way to add.
 *
 * Two gestures, one list:
 *  - DRAG a tile onto the page preview. The drag crosses into the preview frame, and
 *    the frame's bridge (previewBridge) resolves where it lands with the same rules
 *    a move uses; only the result comes back, as an `insert` message.
 *  - CLICK a tile to add it at the marked spot (the `+` on the page), else straight
 *    after the selected block, else at the end of the open region. The page decides
 *    which, so this panel only says what was picked.
 *
 * ⚠ Offers what a REGION accepts plus what only lives inside a container (a column):
 * the drag can aim into a container, so hiding those would make Columns impossible to
 * fill. A pick the target refuses is the page's call, not this list's.
 *
 * The full catalogue (BlockCatalogue) stays one click away for its pictures and
 * descriptions; this is the glanceable set that lives beside the work.
 */
import { useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { TemplateKey } from "@xentium/contracts";
import { listBlocks } from "../../../layout/blockRegistry";
import { iconFor } from "../../../layout/blockIcons";
import { blockLabel } from "../../../lib/coreText";
import "./BlockLibrary.scss";

const CATEGORIES = ["all", "structure", "content", "data", "plugin"] as const;
type Category = (typeof CATEGORIES)[number];

/** The drag's own data type, so a drop elsewhere (a text field) never receives a block. */
export const BLOCK_DRAG_TYPE = "application/x-xentium-block";

export function BlockLibrary({
  templateKey, inserting, onPick, onDragStartType, onDragEndType, onCancelInsert, onBrowseAll,
}: {
  templateKey: TemplateKey;
  /** A spot on the page is marked: the next pick goes there. */
  inserting: boolean;
  onPick: (type: string) => void;
  onDragStartType: (type: string) => void;
  onDragEndType: () => void;
  onCancelInsert: () => void;
  onBrowseAll: () => void;
}) {
  const { t } = useTranslation("acp");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");

  const items = useMemo(
    () => listBlocks().filter((b) => {
      const meta = b.editorMeta;
      if (!meta || meta.retired) return false;
      return !meta.allowedTemplates || meta.allowedTemplates.includes(templateKey);
    }),
    [templateKey],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: items.length };
    for (const b of items) out[b.editorMeta!.category] = (out[b.editorMeta!.category] ?? 0) + 1;
    return out;
  }, [items]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((b) => category === "all" || b.editorMeta!.category === category)
      .filter((b) => !q || blockLabel(b.type).toLowerCase().includes(q) || b.type.toLowerCase().includes(q))
      // Core first, then plugins: a site with a few plugins installed would
      // otherwise bury Heading and Section under a dozen plugin tiles.
      .sort((a, b) => Number(!!a.pluginId) - Number(!!b.pluginId)
        || blockLabel(a.type).localeCompare(blockLabel(b.type)));
  }, [items, category, query]);

  const dragStart = (e: DragEvent<HTMLButtonElement>, type: string) => {
    // `text/plain` as well: Firefox starts no drag without some data, and the custom
    // type is what the preview checks for so an unrelated drag is never a block.
    e.dataTransfer.setData(BLOCK_DRAG_TYPE, type);
    e.dataTransfer.setData("text/plain", blockLabel(type));
    e.dataTransfer.effectAllowed = "copy";
    onDragStartType(type);
  };

  return (
    <div className="lay-lib">
      {inserting && (
        <div className="lay-lib__insert" role="status">
          <span>{t("layoutEditor.library.insertHere")}</span>
          <button type="button" onClick={onCancelInsert}>{t("layoutEditor.cancel")}</button>
        </div>
      )}

      <label className="lay-lib__search">
        <FontAwesomeIcon icon={faMagnifyingGlass} />
        <input
          type="text"
          value={query}
          placeholder={t("layoutEditor.catalogueSearch")}
          aria-label={t("layoutEditor.catalogueSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")}
            title={t("layoutEditor.library.clear")} aria-label={t("layoutEditor.library.clear")}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        )}
      </label>

      <div className="lay-lib__cats" role="tablist">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === category}
            className={c === category ? "is-on" : ""}
            disabled={(counts[c] ?? 0) === 0}
            onClick={() => setCategory(c)}
          >
            {t(c === "all" ? "layoutEditor.categoryAll" : `layoutEditor.category.${c}`)}
          </button>
        ))}
      </div>

      {matches.length === 0 ? (
        <p className="lay-lib__empty">
          {query.trim()
            ? t("layoutEditor.catalogueNoMatch", { query: query.trim() })
            : t("layoutEditor.catalogueEmpty")}
        </p>
      ) : (
        <div className="lay-lib__grid">
          {matches.map((b) => (
            <button
              key={b.type}
              type="button"
              className="lay-lib__tile"
              draggable
              onDragStart={(e) => dragStart(e, b.type)}
              onDragEnd={onDragEndType}
              onClick={() => onPick(b.type)}
              title={t(`layoutEditor.blockDesc.${b.type}`, { defaultValue: blockLabel(b.type) })}
            >
              <span className="lay-lib__glyph"><FontAwesomeIcon icon={iconFor(b.type)} /></span>
              <span className="lay-lib__name">{blockLabel(b.type)}</span>
              {b.pluginId && <span className="lay-lib__badge">{t("layoutEditor.category.plugin")}</span>}
            </button>
          ))}
        </div>
      )}

      <p className="lay-lib__hint">{t("layoutEditor.library.hint")}</p>
      <button type="button" className="lay__browse" onClick={onBrowseAll}>
        {t("layoutEditor.library.browseAll")}
      </button>
    </div>
  );
}
