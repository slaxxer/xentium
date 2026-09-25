import { useTranslation } from "react-i18next";
import { Badge } from "../../../components/Badge";

/**
 * Where a plugin came from, in one badge.
 *
 * Three states, because there really are three, and collapsing any two of them
 * would be a lie:
 *
 *   - **reviewed** — the package carried a signature and it verified. Which tier
 *     is worth saying: "we read the code" and "we glanced at what it ships" are
 *     different promises, and one badge for both devalues the stronger one.
 *   - **unverified** — the package carried no signature. Deliberately quiet, in
 *     muted grey with no icon: this is the normal state for a plugin a developer
 *     wrote, and a badge that shouts at them daily is a badge nobody reads by the
 *     time it matters.
 *   - **not recorded** — installed before signatures existed, so we have no
 *     claim either way. Shown rather than hidden: an admin scanning the list
 *     needs to be able to tell "nobody checked this" from "we do not know",
 *     and an empty space says neither.
 *
 * A package whose signature FAILED never reaches here — it is refused at
 * install, so there is no fourth state to draw.
 */

export interface TrustBadgeProps {
  /** `signatureTier` from the installed row, or `trustTier` from a listing. */
  tier: string | null | undefined;
  /**
   * Whether provenance was recorded at all. For an installed plugin this is
   * `contentDigest !== null`; a listing always knows, so it passes true.
   */
  recorded?: boolean;
}

const TIER_COLOR: Record<string, string> = {
  audited:  "var(--c-success)",
  reviewed: "var(--c-success)",
  unvetted: "var(--c-fg-muted)",
};

export function TrustBadge({ tier, recorded = true }: TrustBadgeProps) {
  const { t } = useTranslation("acp");

  if (tier) {
    return (
      <Badge
        label={t(`trust.tier.${tier}`, { defaultValue: t("trust.reviewed") })}
        color={TIER_COLOR[tier] ?? "var(--c-fg-muted)"}
      />
    );
  }

  if (!recorded) {
    return <Badge label={t("trust.notRecorded")} color="var(--c-fg-subtle)" />;
  }

  return <Badge label={t("trust.unverified")} color="var(--c-fg-muted)" />;
}
