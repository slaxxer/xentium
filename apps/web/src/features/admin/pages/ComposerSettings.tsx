/**
 * ACP → Appearance → Composer.
 *
 * Which tools sit in the action bar, which fall back to the overflow tray, and which
 * are switched off entirely — a setting, not a code change.
 *
 * ⚠ Three placements, one control per tool, and the BAR IS ORDERED. Promoting a tool
 * appends it, so the order an admin builds is the order members see; the mockup drew
 * drag handles, and this is the same decision without a drag-and-drop dependency (it
 * is also the version that works from a keyboard).
 *
 * ⚠ Autosaves, like every other ACP config page (`docs/plugin-acp-autosave.md`).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMPOSER_DEFAULT_CONFIG, COMPOSER_TOOL_IDS, resolveComposerConfig,
  type ComposerConfig, type ComposerPlacement, type ComposerToolId,
} from "@nodevo/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle } from "../../../components/AcpControls";
import { FontAwesomeIcon } from "../../../components/Icon";
import { COMPOSER_TOOLS } from "../../../components/composer/composerTools";
import { COMPOSER_CONFIG_KEY } from "../../../components/composer/useComposerConfig";
import { AcpIcon } from "./acpIcons";
import "./ComposerSettings.scss";

const PLACEMENTS: ComposerPlacement[] = ["bar", "overflow", "off"];

export function ComposerSettings() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

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
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useAutosave({ value: form, savedValue: saved, onSave: (v) => save.mutate(v) });

  const { tools } = resolveComposerConfig(form);
  const placementOf = (id: ComposerToolId): ComposerPlacement =>
    tools.find((x) => x.id === id)?.where ?? "overflow";

  /** Moving a tool is a change to the two lists, never to a third. */
  function place(id: ComposerToolId, where: ComposerPlacement) {
    setTouched(true);
    setForm((f) => {
      const bar = f.bar.filter((x) => x !== id);
      const off = f.off.filter((x) => x !== id);
      if (where === "bar") bar.push(id);      // appended: the admin builds the order
      if (where === "off") off.push(id);
      return { ...f, bar, off };
    });
  }

  const inBar = form.bar.length;

  return (
    <div className="bdg-page" style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("composer.eyebrow")}</p>
          <h1 className="pg-title">{t("composer.title")}</h1>
          <p className="pg-sub">{t("composer.subtitle")}</p>
        </div>
        <SaveChip saving={save.isPending} />
      </div>

      <div className="set-content">
        <section className="set-card">
          <div className="set-card__head">
            <div className="set-card__icon"><AcpIcon name="sliders" size={18} /></div>
            <div className="set-card__titles">
              <h3>{t("composer.toolsTitle")}</h3>
              <p>{t("composer.toolsSub", { count: inBar })}</p>
            </div>
          </div>

          <div className="set-extra">
            {/* A preview of the row members will actually get, in the admin's order. */}
            <div className="cmp-preview">
              <span className="cmp-preview__label">{t("composer.barPreview")}</span>
              <span className="cmp-preview__bar">
                {form.bar.length === 0
                  ? <em>{t("composer.barEmpty")}</em>
                  : form.bar.map((id) => (
                      <span key={id} className="cmp-preview__tool" title={t(`composer.tool.${id}`, { ns: "common" })}>
                        <FontAwesomeIcon className="cmp-ic" icon={COMPOSER_TOOLS[id].icon} />
                      </span>
                    ))}
              </span>
            </div>

            <div className="cmp-list">
              {COMPOSER_TOOL_IDS.map((id) => {
                const where = placementOf(id);
                return (
                  <div key={id} className={`cmp-row is-${where}`}>
                    <span className="cmp-row__ic">
                      <FontAwesomeIcon className="cmp-ic" icon={COMPOSER_TOOLS[id].icon} />
                    </span>
                    <span className="cmp-row__name">
                      {t(`composer.tool.${id}`, { ns: "common" })}
                      <em>{t(`composer.group.${tools.find((x) => x.id === id)?.group}`, { ns: "common" })}</em>
                    </span>
                    <div className="acp-seg acp-seg--auto cmp-row__seg">
                      {PLACEMENTS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={where === p ? "is-on" : ""}
                          onClick={() => place(id, p)}
                        >
                          {t(`composer.place.${p}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

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
                <Toggle
                  on={form.mentions}
                  onToggle={() => { setTouched(true); setForm((f) => ({ ...f, mentions: !f.mentions })); }}
                />
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
    </div>
  );
}
