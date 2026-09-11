/**
 * Rank progress — ONE implementation, used wherever it appears.
 *
 * ⚠ There used to be two. `ProgressionCard` on the home rail read
 * `GET /users/me/progression` and drew its own bar in the `home` namespace, while the
 * profile's `profileRank` read `GET /users/:id/progression` and drew a different bar
 * in `profiles`. Two endpoints whose shapes had already drifted apart, two sets of
 * CSS, two translations of the same sentence — for one concept.
 *
 * The only thing that legitimately differs between the two places is WHOSE rank is
 * being shown: on a profile it is that member's, on the home rail it is the viewer's
 * own. That is `useRankSubject`, and it is the whole difference.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { previewSample, SAMPLE_RANK } from "../../layout/previewSample";
import "./rank.scss";

export interface RankData {
  enabled: boolean;
  showProgressBar?: boolean;
  current?: { badgeLabel: string | null; badgeColor: string | null; ladderPosition: number | null } | null;
  next?:    { badgeLabel: string | null; badgeColor: string | null; ladderPosition: number | null } | null;
  atTop?: boolean;
  percent?: number;
  primary?: { label: string; have: number; need: number; remaining: number } | null;
  unlocks?: { key: string; value: number }[];
  canUploadCover?: boolean;
  coverUnlocksAt?: string | null;
}

/**
 * Whose rank a block is about.
 *
 * ⚠ Context first, viewer second. A block placed on a PROFILE is about the member
 * whose page it is; the same block on the home rail has no profile to be about, so
 * it falls back to the person reading. Getting this backwards would show visitors
 * their own rank on somebody else's profile.
 */
export function useRankSubject(context: unknown): string | null {
  const { user } = useAuth();
  const profileId = (context as { profile?: { id?: string } } | null)?.profile?.id;
  return profileId ?? user?.id ?? null;
}

/**
 * Rank data for a block, from whichever source is available.
 *
 * ⚠ CONTEXT FIRST. The profile page already resolves progression into its context —
 * that is the decomposition rule the other profile blocks follow, and a block that
 * fetched regardless would put a second request on a page that had already made it.
 * On the home rail there is no such host, so it asks.
 *
 * The fetch is disabled rather than skipped, because a hook cannot be conditional.
 */
export function useRankFor(context: unknown): RankData | undefined {
  const fromHost = (context as { progression?: RankData | null } | null)?.progression;
  const subject  = useRankSubject(context);
  const query    = useRank(fromHost ? null : subject);
  const real     = fromHost ?? query.data;

  // ⚠ A member on no rung is the EMPTY case here, not just "no data" — `enabled` can
  // be true while `current` is null. Sample only then, and only for staff in the
  // editor; see `previewSample`.
  if (real?.enabled && real.current) return real;
  return previewSample(SAMPLE_RANK) ?? real;
}

/** The one place rank data is fetched. */
export function useRank(userId: string | null | undefined) {
  return useQuery<RankData>({
    queryKey: ["progression", userId],
    queryFn:  () => api.get(`/users/${userId}/progression`),
    enabled:  !!userId,
    staleTime: 60_000,
  });
}

/**
 * Where this member stands, and what the next rung grants.
 *
 * Self-gating: a site with progression switched off, or a member on no ladder,
 * renders nothing at all rather than an empty card.
 */
export function RankProgress({ data, showUnlocks = true }: { data: RankData | undefined; showUnlocks?: boolean }) {
  const { t } = useTranslation("profiles");
  const p = data;
  if (!p?.enabled || !p.current) return null;

  const pct    = Math.max(0, Math.min(100, p.percent ?? 0));
  const accent = p.next?.badgeColor ?? p.current.badgeColor ?? "var(--c-accent)";

  return (
    <div className="profile-rank">
      <div className="profile-rank__head">
        <span className="profile-rail__title">{t("rank.progress")}</span>
        {!p.atTop && <span className="profile-rank__pct">{pct}%</span>}
      </div>

      <div className="profile-rank__rungs">
        <span className="profile-rank__chip"
          style={{ color: p.current.badgeColor ?? undefined,
                   background: p.current.badgeColor ? `${p.current.badgeColor}20` : undefined }}>
          {p.current.badgeLabel}
        </span>
        {p.next && (
          <span className="profile-rank__chip profile-rank__chip--next"
            style={{ color: p.next.badgeColor ?? undefined,
                     background: p.next.badgeColor ? `${p.next.badgeColor}20` : undefined }}>
            {p.next.badgeLabel}
          </span>
        )}
      </div>

      {/* The bar is an ADMIN setting (`progression.show_progress_bar`), so it can be
          off on a site that ranks people without racing them. */}
      {p.showProgressBar !== false && !p.atTop && (
        <div className="profile-rank__bar">
          <span style={{ width: `${pct}%`, background: accent }} />
        </div>
      )}

      <p className="profile-rank__caption">
        {p.atTop
          ? t("rank.atTop")
          : p.primary
            ? t("rank.remaining", {
                count:  p.primary.remaining,
                metric: t(`rank.metric.${p.primary.label}`, { defaultValue: p.primary.label }),
                rank:   p.next?.badgeLabel ?? "",
              })
            : t("rank.keepGoing")}
      </p>

      {/* What the next rung actually gives. Omitted at the top of the ladder, where
          there is no next rung to describe. */}
      {showUnlocks && !p.atTop && (p.unlocks?.length ?? 0) > 0 && (
        <>
          <div className="profile-rail__title profile-rank__unlocks-title">
            {t("rank.unlocks", { rank: p.next?.badgeLabel ?? "" })}
          </div>
          <ul className="profile-rank__unlocks">
            {p.unlocks!.map((u) => (
              <li key={u.key}>
                <FontAwesomeIcon icon={faCheck} />
                {t(`rank.unlock.${u.key}`, {
                  count: u.value,
                  value: u.value.toLocaleString(),
                  defaultValue: `${u.value.toLocaleString()} ${u.key}`,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
