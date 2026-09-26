import { useTranslation } from "react-i18next";
import { faUsers } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import type { Power } from "./groupModel";

/** A group's icon, or the default glyph tinted with its badge colour. */
export function GroupGlyph({ icon, color, size = "md", preview }: {
  icon: string | null; color: string; size?: "md" | "lg"; preview?: string | null;
}) {
  const src = preview ?? (icon ? `/uploads/${icon}` : null);
  return (
    <span
      className={`gp-glyph gp-glyph--${size}`}
      style={src ? undefined : { color, background: `${color}20`, borderColor: `${color}40` }}
    >
      {src ? <img src={src} alt="" /> : <FontAwesomeIcon icon={faUsers} />}
    </span>
  );
}

/** Four segments and a word: how much this group can do. */
export function PowerMeter({ power }: { power: Power }) {
  const { t } = useTranslation("acp");
  return (
    <span className={`gp-meter gp-meter--${power.level}`} title={t(`groups.power.${power.level}Hint`)}>
      <span className="gp-meter__bars" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < power.segments ? "is-lit" : ""} />)}
      </span>
      <span className="gp-meter__label">{t(`groups.power.${power.level}`)}</span>
    </span>
  );
}
