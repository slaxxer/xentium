import { useTranslation } from "react-i18next";
import { Badge } from "../../../components/Badge";

/**
 * Where a plugin came from.
 *
 * TWO MODES, because the two screens ask different questions and answering both
 * with one word would make the badge useless on one of them.
 *
 * **`origin`** — the Installed list. "Is this code from Xentium?" An installed
 * plugin can have come from anywhere, so this is the question that matters, and
 * the answer is official / non-official. Three states, because there really are
 * three:
 *
 *   - **official** — the package carried our signature and it verified.
 *   - **non-official** — no signature. Deliberately quiet, in muted grey: this
 *     is the normal state for a plugin a developer wrote, and a badge that
 *     shouts at them daily is one nobody reads by the time it matters.
 *   - **not recorded** — installed before signatures existed, so there is no
 *     claim either way. Shown rather than hidden: an admin scanning the list has
 *     to be able to tell "nobody checked this" from "we do not know", and blank
 *     space says neither.
 *
 * **`tier`** — the Marketplace browse grid. Everything there is official by
 * definition, so saying so on every card is noise. What a buyer has not been
 * told yet is HOW HARD we looked: reading the code and glancing at what it
 * ships are different promises, and one badge for both devalues the stronger.
 *
 * A package whose signature FAILED never reaches either screen — it is refused
 * at install, so there is no fourth state to draw.
 */

export interface TrustBadgeProps {
  /** `signatureTier` from the installed row, or `trustTier` from a listing. */
  tier: string | null | undefined;
  /**
   * Whether provenance was recorded at all. For an installed plugin this is
   * `contentDigest !== null`; a listing always knows, so it passes true.
   */
  recorded?: boolean;
  /** Which question this screen is asking. See above. */
  mode?: "origin" | "tier";
}

const TIER_COLOR: Record<string, string> = {
  audited:  "var(--c-success)",
  reviewed: "var(--c-success)",
  unvetted: "var(--c-fg-muted)",
};

export function TrustBadge({ tier, recorded = true, mode = "origin" }: TrustBadgeProps) {
  const { t } = useTranslation("acp");

  if (mode === "tier") {
    if (!tier) return null;
    return (
      <Badge
        label={t(`trust.tier.${tier}`, { defaultValue: t("trust.official") })}
        color={TIER_COLOR[tier] ?? "var(--c-fg-muted)"}
      />
    );
  }

  // Signed by us, whatever depth of review it carries: it came from Xentium.
  if (tier) return <Badge label={t("trust.official")} color="var(--c-success)" />;

  if (!recorded) return <Badge label={t("trust.notRecorded")} color="var(--c-fg-subtle)" />;

  return <Badge label={t("trust.nonOfficial")} color="var(--c-fg-muted)" />;
}
