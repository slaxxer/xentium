import { useTranslation } from "react-i18next";
import { faUsers } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import type { Power } from "./groupModel";

/** A group's glyph, tinted with its badge colour. (Custom group icons were dropped
 *  2026-10-02: a rank image is how a group shows itself now.) */
export function GroupGlyph({ color, size = "md" }: { color: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={`gp-glyph gp-glyph--${size}`}
      style={{ color, background: `${color}20`, borderColor: `${color}40` }}
    >
      <FontAwesomeIcon icon={faUsers} />
    </span>
  );
}

/** Four segments and a word: how much this group can do. `compact` drops the word. */
export function PowerMeter({ power, compact }: { power: Power; compact?: boolean }) {
  const { t } = useTranslation("acp");
  return (
    <span className={`gp-meter gp-meter--${power.level}${compact ? " gp-meter--compact" : ""}`}
      title={compact ? t(`groups.power.${power.level}`) : t(`groups.power.${power.level}Hint`)}>
      <span className="gp-meter__bars" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < power.segments ? "is-lit" : ""} />)}
      </span>
      {!compact && <span className="gp-meter__label">{t(`groups.power.${power.level}`)}</span>}
    </span>
  );
}
