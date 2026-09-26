import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { faChevronRight, faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { Toggle } from "../../../../components/AcpControls";
import { slotRegistry, type GroupConfigPanelSlot } from "../../../../plugins/slotRegistry";
import type { ProgressionData } from "./groupModel";

/** The image types a rank may be granted. GIF is the one that means "animated". */
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type NumKey = "ladderPosition" | "minArticles" | "minComments" | "minDaysMember" | "minLikesReceived"
  | "maxArticleLength" | "maxDailyArticles" | "maxCommentLength" | "maxDailyComments";

export function ProgressionTab({ prog, setProg, panels, onOpenPanel }: {
  prog: ProgressionData;
  setProg: Dispatch<SetStateAction<ProgressionData | null>>;
  panels: GroupConfigPanelSlot[];
  onOpenPanel: (id: string) => void;
}) {
  const { t } = useTranslation("acp");
  const patch = (p: Partial<ProgressionData>) => setProg((cur) => cur && { ...cur, ...p });

  const num = (k: NumKey, label: string, placeholder: string, min = 0) => (
    <label key={k} className="gp-field">
      <span className="gp-label">{label}</span>
      <input className="inp" type="number" min={min} value={prog[k] ?? ""} placeholder={placeholder}
        onChange={(e) => patch({ [k]: e.target.value === "" ? null : Math.max(min, Math.floor(Number(e.target.value))) })} />
    </label>
  );

  return (
    <div className="gp-grid">
      <section className="gp-card gp-pad">
        <div className="gp-toggle-row gp-toggle-row--first">
          <div>
            <div className="gp-toggle-row__title">{t("groups.prog.onLadder")}</div>
            <div className="gp-hint">{t("groups.prog.onLadderHint")}</div>
          </div>
          <Toggle on={prog.isProgressionGroup} onToggle={() => patch({ isProgressionGroup: !prog.isProgressionGroup })} />
        </div>

        <div className="gp-field gp-field--narrow">
          {num("ladderPosition", t("groups.prog.position"), "—", 1)}
          <span className="gp-hint">{t("groups.prog.positionHint")}</span>
        </div>

        <h3 className="gp-subsection">{t("groups.prog.thresholds")} <span>{t("groups.prog.thresholdsNote")}</span></h3>
        <div className="gp-two">
          {num("minArticles", t("groups.prog.minArticles"), "—")}
          {num("minComments", t("groups.prog.minComments"), "—")}
          {num("minDaysMember", t("groups.prog.minDays"), "—")}
          {num("minLikesReceived", t("groups.prog.minLikes"), "—")}
        </div>

        {panels.length > 0 && (
          <>
            <h3 className="gp-subsection">{t("groups.prog.contributed")} <span>{t("groups.prog.contributedNote")}</span></h3>
            <div className="gp-contrib">
              {panels.map((p) => (
                <button key={p.id} type="button" className="gp-contrib__item" onClick={() => onOpenPanel(p.id)}>
                  <FontAwesomeIcon icon={faPuzzlePiece} className="gp-contrib__icon" />
                  <span className="gp-contrib__main">
                    <span className="gp-contrib__label">{p.label}</span>
                    <span className="gp-hint">{t("groups.prog.contributedItem", { plugin: slotRegistry.ownerOf(p.id) ?? p.id })}</span>
                  </span>
                  <FontAwesomeIcon icon={faChevronRight} />
                </button>
              ))}
            </div>
            <p className="gp-hint">{t("groups.prog.contributedFoot")}</p>
          </>
        )}
      </section>

      <section className="gp-card gp-pad">
        <h3 className="gp-subsection gp-subsection--first">{t("groups.prog.limits")} <span>{t("groups.prog.limitsNote")}</span></h3>
        <div className="gp-two">
          {num("maxArticleLength", t("groups.prog.maxArticleLength"), t("groups.unlimited"))}
          {num("maxDailyArticles", t("groups.prog.maxDailyArticles"), t("groups.unlimited"))}
          {num("maxCommentLength", t("groups.prog.maxCommentLength"), t("groups.unlimited"))}
          {num("maxDailyComments", t("groups.prog.maxDailyComments"), t("groups.unlimited"))}
        </div>

        <h3 className="gp-subsection">{t("groups.prog.images")}</h3>
        <label className="gp-field gp-field--narrow">
          <span className="gp-label">{t("groups.prog.maxImageKb")}</span>
          {/* Stored in BYTES, typed in KB — an admin should not count zeroes to say "512 KB". */}
          <input className="inp" type="number" min={0} placeholder={t("groups.unlimited")}
            value={prog.maxProfileImageBytes == null ? "" : Math.round(prog.maxProfileImageBytes / 1024)}
            onChange={(e) => patch({ maxProfileImageBytes: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) * 1024 })} />
        </label>

        <div className="gp-toggle-row">
          <Toggle on={prog.canUploadCover} onToggle={() => patch({ canUploadCover: !prog.canUploadCover })} />
          <div>
            <div className="gp-toggle-row__title">{t("groups.prog.cover")}</div>
            <div className="gp-hint">{t("groups.prog.coverHint")}</div>
          </div>
        </div>

        <div className="gp-field">
          <span className="gp-label">{t("groups.prog.imageTypes")}</span>
          <div className="gp-types">
            {PROFILE_IMAGE_TYPES.map((mime) => {
              const on = prog.allowedProfileImageTypes.includes(mime);
              return (
                <button key={mime} type="button" aria-pressed={on} className={`gp-type${on ? " is-on" : ""}`}
                  onClick={() => patch({ allowedProfileImageTypes: on ? prog.allowedProfileImageTypes.filter((m) => m !== mime) : [...prog.allowedProfileImageTypes, mime] })}>
                  {mime.replace("image/", "")}
                </button>
              );
            })}
          </div>
          {/* ⚠ Empty means NO per-rank restriction, not "nothing allowed". */}
          <span className="gp-hint">{t("groups.prog.imageTypesNote")}</span>
        </div>
      </section>
    </div>
  );
}
