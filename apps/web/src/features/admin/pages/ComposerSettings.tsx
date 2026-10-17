/**
 * ACP → Content → Editor.
 *
 * Which tools members get when they write, and where each one sits: in the TOOLBAR
 * (ordered, what members see first), in the MENU (one click away), or OFF.
 *
 * Layout (concept "2b, tiles by group"): the toolbar on top as it will appear, with
 * ‹ › to move a tool; below, one tile per tool, grouped (marks, blocks, align,
 * insert). Clicking a tile cycles toolbar → menu → off, and each group can set all
 * of its tools at once. Moving with buttons rather than drag keeps it usable from a
 * keyboard and needs no drag-and-drop dependency. A tool sent to the toolbar is
 * appended, so the order the admin builds is the order members get.
 *
 * ⚠ A settings page: changes are a draft the ACP save bar saves (`useAutosave` is
 * the save-bar hook under its old name, `docs/plugin-acp-autosave.md`).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMPOSER_DEFAULT_CONFIG, COMPOSER_TOOL_IDS, resolveComposerConfig,
  type ComposerConfig, type ComposerPlacement, type ComposerToolGroup, type ComposerToolId,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle } from "../../../components/AcpControls";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { COMPOSER_TOOLS } from "../../../components/composer/composerTools";
import { COMPOSER_CONFIG_KEY } from "../../../components/composer/useComposerConfig";
import { AcpIcon } from "./acpIcons";
import "./ComposerSettings.scss";

const PLACEMENTS: ComposerPlacement[] = ["bar", "overflow", "off"];
const GROUPS: ComposerToolGroup[] = ["marks", "blocks", "align", "insert"];
/** What a click on a tile does next. */
const NEXT: Record<ComposerPlacement, ComposerPlacement> = { bar: "overflow", overflow: "off", off: "bar" };
type Filter = "all" | ComposerPlacement;

export function ComposerSettings() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const { data } = useQuery<ComposerConfig>({
    queryKey: [...COMPOSER_CONFIG_KEY],
    queryFn:  () => api.get("/appearance/composer"),
  });

  const saved = data ?? COMPOSER_DEFAULT_CONFIG;
  const [form, setForm] = useState<ComposerConfig>(saved);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setForm(saved); }, [saved, touched]);

  const save = useMutation({
    mutationFn: (config: ComposerConfig) => api.put<ComposerConfig>("/appearance/composer", config),
    onSuccess: (fresh) => {
      // ⚠ Writes the SAME cache the editors read, so every composer already on
      // screen restyles the moment this saves.
      qc.setQueryData([...COMPOSER_CONFIG_KEY], fresh);
      setTouched(false);
    },
  });

  useAutosave({
    value: form, savedValue: saved, label: t("composer.title"),
    onSave: (v) => save.mutateAsync(v),
    onDiscard: () => { setForm(saved); setTouched(false); },
  });

  const { tools } = resolveComposerConfig(form);
  const placementOf = (id: ComposerToolId): ComposerPlacement =>
    tools.find((x) => x.id === id)?.where ?? "overflow";
  const edit = (fn: (f: ComposerConfig) => ComposerConfig) => { setTouched(true); setForm(fn); };

  /** Moving tools is a change to the two lists (bar, off), never to a third. */
  const place = (ids: ComposerToolId[], where: ComposerPlacement) => edit((f) => {
    const moving = new Set(ids);
    // Already in the bar keeps its spot; newcomers are appended in tile order.
    const bar = where === "bar"
      ? [...f.bar, ...ids.filter((x) => !f.bar.includes(x))]
      : f.bar.filter((x) => !moving.has(x));
    const off = where === "off"
      ? [...f.off.filter((x) => !moving.has(x)), ...ids]
      : f.off.filter((x) => !moving.has(x));
    return { ...f, bar, off };
  });

  /** ‹ › on a toolbar chip: one place left or right. */
  const shift = (id: ComposerToolId, dir: -1 | 1) => edit((f) => {
    const bar = [...f.bar];
    const i = bar.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= bar.length) return f;
    [bar[i], bar[j]] = [bar[j]!, bar[i]!];
    return { ...f, bar };
  });

  const count = (where: ComposerPlacement, ids: readonly ComposerToolId[] = COMPOSER_TOOL_IDS) =>
    ids.filter((id) => placementOf(id) === where).length;
  const toolName = (id: ComposerToolId) => t(`composer.tool.${id}`, { ns: "common" });

  return (
    <div className="cmp-page">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("composer.eyebrow")}</p>
          <h1 className="pg-title">{t("composer.title")}</h1>
          <p className="pg-sub">{t("composer.subtitle")}</p>
        </div>
        <span className="cmp-head-side"><SaveChip saving={save.isPending} /></span>
      </div>

      {/* The toolbar as members get it, in the admin's order. */}
      <section className="set-card cmp-bar">
        <div className="set-card__head">
          <div className="set-card__icon"><AcpIcon name="sliders" size={18} /></div>
          <div className="set-card__titles">
            <h3>{t("composer.barTitle")}</h3>
            <p>{t("composer.barSub")}</p>
          </div>
        </div>
        <div className="cmp-bar__row">
          {form.bar.length === 0
            ? <em className="cmp-bar__empty">{t("composer.barEmpty")}</em>
            : form.bar.map((id, i) => (
                <span key={id} className="cmp-chip">
                  <FontAwesomeIcon className="cmp-chip__ic" icon={COMPOSER_TOOLS[id].icon} />
                  <span>{toolName(id)}</span>
                  <button type="button" disabled={i === 0} aria-label={t("composer.moveLeft", { tool: toolName(id) })}
                    onClick={() => shift(id, -1)}><FontAwesomeIcon icon={faChevronLeft} /></button>
                  <button type="button" disabled={i === form.bar.length - 1} aria-label={t("composer.moveRight", { tool: toolName(id) })}
                    onClick={() => shift(id, 1)}><FontAwesomeIcon icon={faChevronRight} /></button>
                </span>
              ))}
        </div>
      </section>

      <div className="cmp-filters">
        <div className="acp-seg acp-seg--auto" role="tablist">
          {(["all", ...PLACEMENTS] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? t("composer.filterAll") : t(`composer.place.${f}`)}
              <span className="cmp-filters__n">{f === "all" ? COMPOSER_TOOL_IDS.length : count(f)}</span>
            </button>
          ))}
        </div>
        <span className="cmp-filters__hint">{t("composer.cycleHint")}</span>
      </div>

      {GROUPS.map((group) => {
        const ids = COMPOSER_TOOL_IDS.filter((id) => tools.find((x) => x.id === id)?.group === group);
        const shown = ids.filter((id) => filter === "all" || placementOf(id) === filter);
        if (shown.length === 0) return null;
        return (
          <section key={group} className="cmp-group">
            <header className="cmp-group__head">
              <h2>{t(`composer.group.${group}`, { ns: "common" })}</h2>
              <span className="cmp-group__counts">
                {t("composer.groupCounts", { bar: count("bar", ids), menu: count("overflow", ids), off: count("off", ids) })}
              </span>
              <span className="cmp-group__rule" />
              <span className="cmp-group__all">
                {t("composer.setAll")}
                {PLACEMENTS.map((p) => (
                  <button key={p} type="button" onClick={() => place(ids, p)}>{t(`composer.place.${p}`)}</button>
                ))}
              </span>
            </header>
            <div className="cmp-tiles">
              {shown.map((id) => {
                const where = placementOf(id);
                const pos = form.bar.indexOf(id) + 1;
                return (
                  <button key={id} type="button" className={`cmp-tile is-${where}`}
                    aria-label={`${toolName(id)}: ${t(`composer.state.${where}`, { n: pos })}`}
                    onClick={() => place([id], NEXT[where])}>
                    <span className="cmp-tile__ic"><FontAwesomeIcon icon={COMPOSER_TOOLS[id].icon} /></span>
                    <span className="cmp-tile__text">
                      <b>{toolName(id)}</b>
                      <span>{t(`composer.state.${where}`, { n: pos })}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="set-card">
        <div className="set-card__head">
          <div className="set-card__icon"><AcpIcon name="at" size={18} /></div>
          <div className="set-card__titles">
            <h3>{t("composer.behaviourTitle")}</h3>
            <p>{t("composer.behaviourSub")}</p>
          </div>
        </div>
        <div className="set-rows">
          <div className="set-row">
            <div>
              <div className="set-row__label">{t("composer.mentions")}</div>
              <div className="set-row__desc">{t("composer.mentionsDesc")}</div>
            </div>
            <div className="set-row__control">
              <Toggle on={form.mentions} onToggle={() => edit((f) => ({ ...f, mentions: !f.mentions }))} />
            </div>
          </div>
        </div>
        {/* ⚠ Said plainly rather than drawn as a switch that cannot work.
            Attachments exist only where a plugin provides an endpoint, and there
            is no GIF service configured at all. */}
        <div className="set-extra">
          <p className="acp-hint">{t("composer.notSupported")}</p>
        </div>
      </section>
    </div>
  );
}
