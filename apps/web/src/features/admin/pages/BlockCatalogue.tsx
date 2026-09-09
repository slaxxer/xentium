/**
 * THE BLOCK CATALOGUE — the browsing path, at full size.
 *
 * There are three ways to add a block and each answers a different question.
 *  - `+` on a region opens the PICKER: you know the name, type three letters, Enter.
 *  - The rail's LIBRARY is the glanceable set: labels and glyphs, always on screen.
 *  - This is for "what can this site even do" — the only one with room for a block's
 *    shape, a sentence about it, and a filter by kind.
 *
 * The first two are deliberately terse because they live beside the work. This one
 * takes the screen, so it can afford to explain, and it is the only place a block
 * that an admin has never heard of gets described rather than merely named.
 *
 * ⚠ It offers exactly what the target accepts — `listPlaceableBlocks(templateKey,
 * parentType)`, the same call the picker makes. A catalogue that showed everything
 * and then refused half of it on click would be a worse catalogue than a short one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { TemplateKey } from "@nodevo/contracts";
import { listPlaceableBlocks } from "../../../layout/blockRegistry";
import { BlockArt } from "../../../layout/blockArt";
import "./BlockCatalogue.scss";

/** "All", then the build order the rest of the editor uses. */
const CATEGORIES = ["all", "structure", "content", "data", "plugin"] as const;
type Category = (typeof CATEGORIES)[number];

export function BlockCatalogue({
  templateKey, parentType, regionName, narrow, onPick, onClose,
}: {
  templateKey: TemplateKey;
  /** The container being added into, or null for the region itself. */
  parentType?: string | null;
  /** Where a pick lands, in words — the dialog says so in its title. */
  regionName: string;
  /** The target is a rail: page-width blocks are marked, exactly as in the picker. */
  narrow?: boolean;
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("acp");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // Opens focused: this dialog exists to be searched, and a search box you have to
  // click first is a search box that costs more than the list it filters.
  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = useMemo(
    () => listPlaceableBlocks(templateKey, parentType ?? undefined),
    [templateKey, parentType],
  );

  /** How many of each kind there are, so a tab can say whether it is worth opening. */
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: items.length };
    for (const b of items) {
      const c = b.editorMeta!.category;
      out[c] = (out[c] ?? 0) + 1;
    }
    return out;
  }, [items]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((b) => category === "all" || b.editorMeta!.category === category)
      .filter((b) => !q
        || b.editorMeta!.label.toLowerCase().includes(q)
        || b.type.toLowerCase().includes(q)
        // The description is searched too: someone looking for "avatar" should find
        // the profile card whether or not the word is in its name.
        || t(`layoutEditor.blockDesc.${b.type}`, { defaultValue: "" }).toLowerCase().includes(q))
      .sort((a, b) => a.editorMeta!.label.localeCompare(b.editorMeta!.label));
  }, [items, category, query, t]);

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal nv-cat"
        role="dialog"
        aria-modal="true"
        aria-label={t("layoutEditor.catalogueTitle", { region: regionName })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nv-cat__head">
          <div className="nv-cat__title">
            <h2>{t("layoutEditor.catalogueTitle", { region: regionName })}</h2>
            <p>{t("layoutEditor.catalogueNote")}</p>
          </div>
          <button type="button" className="btn-ghost btn-sm"
            onClick={onClose}
            title={t("layoutEditor.closeCatalogue")} aria-label={t("layoutEditor.closeCatalogue")}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="nv-cat__controls">
          <div className="nv-cat__search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={t("layoutEditor.catalogueSearch")}
              aria-label={t("layoutEditor.catalogueSearch")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="nv-cat__tabs" role="tablist">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={c === category}
                className={c === category ? "is-on" : ""}
                // A kind with nothing in it is disabled rather than hidden: which
                // kinds EXIST is part of what a catalogue teaches, and a tab row that
                // changes shape per template teaches the opposite.
                disabled={(counts[c] ?? 0) === 0}
                onClick={() => setCategory(c)}
              >
                {t(c === "all" ? "layoutEditor.categoryAll" : `layoutEditor.category.${c}`)}
                <span>{counts[c] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="nv-cat__body">
          {matches.length === 0 ? (
            <div className="nv-cat__empty">
              <b>{query.trim()
                ? t("layoutEditor.catalogueNoMatch", { query: query.trim() })
                : t("layoutEditor.catalogueEmpty")}</b>
              <span>{t("layoutEditor.catalogueRetry")}</span>
            </div>
          ) : (
            <div className="nv-cat__grid">
              {matches.map((block) => {
                const desc = t(`layoutEditor.blockDesc.${block.type}`, { defaultValue: "" });
                return (
                  <button
                    key={block.type}
                    type="button"
                    className="nv-cat__card"
                    onClick={() => { onPick(block.type); onClose(); }}
                  >
                    <span className="nv-cat__art"><BlockArt type={block.type} /></span>
                    <span className="nv-cat__meta">
                      <span className="nv-cat__name">
                        {block.editorMeta!.label}
                        {block.pluginId && (
                          <span className="nv-cat__badge">{t("layoutEditor.category.plugin")}</span>
                        )}
                        {narrow && block.editorMeta!.wide && (
                          <span className="lay__picker-wide" title={t("layoutEditor.wideHint")}>
                            {t("layoutEditor.wide")}
                          </span>
                        )}
                      </span>
                      {/* Omitted rather than faked. Core describes the blocks it ships;
                          a plugin's block has no core string and gets its type instead,
                          which is at least true. */}
                      {desc && <span className="nv-cat__desc">{desc}</span>}
                      <code>{block.pluginId ? `${block.pluginId} · ${block.type}` : block.type}</code>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
