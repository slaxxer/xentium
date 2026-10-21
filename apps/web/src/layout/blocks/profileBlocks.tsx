/**
 * The profile card, decomposed (ADR-0005).
 *
 * The profile was the first page taken apart properly: rather than one
 * `profilePage` block, the card's pieces are individually placeable, so an admin can
 * move the avatar to the other side, drop the bio, put the stats above the name, or
 * pull the tabs out of the card entirely.
 *
 * ## Why the pieces carry no layout
 *
 * `profileCard` is only the panel — background, radius, padding. The ARRANGEMENT
 * inside it is `columns`/`column`, the same generic containers every other template
 * uses. That is what keeps this from becoming a bespoke profile layout engine: the
 * avatar sits in an `auto` track beside a weighted one, and moving it is an ordinary
 * block move, not a special case.
 *
 * The old markup nested `.profile-header > .profile-info > .profile-title-row` to get
 * the same effect with fixed flex wrappers. Those wrappers could not survive pieces
 * becoming movable — a wrapper an admin cannot see or reorder is exactly the thing a
 * layout document replaces — so each piece now styles only itself.
 *
 * ## Data
 *
 * Every block here reads `ProfileContext`, which the `ProfilePage` host resolves
 * once: the profile, the tab state, the stat rows (including plugin-contributed
 * ones), and the follow/block handlers. None of them fetch, and none of them take a
 * prop that selects data — the props are presentational only.
 */
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faLock, faUserSlash, faUserCheck, faChevronRight, faChevronDown,
  faImage, faXmark, faCloudArrowUp,
} from "@fortawesome/free-solid-svg-icons";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { blockPropSchemas } from "@xentium/contracts";
import { Username } from "../../components/Username";
import "../../components/Avatar.scss";
import { slotRegistry } from "../../plugins/slotRegistry";
import { registerBlock, type BlockProps } from "../blockRegistry";
import { sectionBackground } from "./coreBlocks";
import { BadgeMark } from "../../components/UserBadges";
import { useBadgeCatalogue, useUserBadges } from "../../lib/userBadges";
import { useProfileVisitors } from "../../lib/profileVisitors";
import {
  previewSample, SAMPLE_BADGES, SAMPLE_FOLLOWERS, SAMPLE_VISITORS,
} from "../previewSample";
import { RankProgress, useRankFor } from "../../features/progression/rank";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { toast } from "../../lib/toast";
import { apiErrorMessage } from "../../lib/swal";
import { useRankImages } from "../../lib/rankImage";
import "../../components/RankBadge.scss";
import { WarningsTab } from "../../features/profiles/WarningsTab";
import {
  InformationTab,
  ProfileArticlesTab,
  ProfileWall,
  UserList,
  type ProfileContext,
} from "../../features/profiles/ProfilePage";
import { uiLocale } from "../../lib/i18n";

type Ctx<P = unknown> = BlockProps<P, ProfileContext>;

/** Every profile block needs a profile, so none is placeable anywhere else. */
const ON_PROFILE: { allowedTemplates: string[] } = { allowedTemplates: ["profile"] };

// ── The panel ───────────────────────────────────────────────────────────────

registerBlock({
  type:      "profileCard",
  schema:    blockPropSchemas.profileCard,
  container: true,
  editorMeta: { surface: true, label: "Profile card", category: "structure", ...ON_PROFILE },
  component: ({ props, children }: Ctx<{ padding: string }>) => (
    <div className={`profile-card profile-card--pad-${props.padding}`}>{children}</div>
  ),
});

// ── The pieces ──────────────────────────────────────────────────────────────

registerBlock({
  type:   "profileAvatar",
  schema: blockPropSchemas.profileAvatar,
  editorMeta: { label: "Avatar", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{ size: string; overlap: boolean }>) => {
    const { profile } = context;
    const { t } = useTranslation("common");
    return (
      <div className={`profile-av profile-av--${props.size}${props.overlap ? " profile-av--overlap" : ""}`}>
        {profile.avatar
          ? <img src={profile.avatar} alt={profile.username} />
          : <span>{profile.username.charAt(0).toUpperCase()}</span>}
        {profile.online && (
          <span className="profile-av__pres" role="status" aria-label={t("online.word")} title={t("online.word")}>
            {/* The same breathing ring as every other avatar's online dot (Avatar.scss). */}
            <span className="hearth-ava__pulse" aria-hidden="true" />
          </span>
        )}
      </div>
    );
  },
});

/**
 * Former usernames: a chevron beside the name that opens the latest ones.
 *
 * Which names arrive, and for how long, is the admin's (ACP → Settings, previous
 * usernames + day window); the member cannot hide it. A `<details>` for keyboard and
 * screen-reader behaviour for free, closed on an outside click or Escape like any menu.
 */
function FormerUsernames({ names }: { names: Array<{ username: string; changedAt: string }> }) {
  const { t } = useTranslation("profiles");
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const label = t("formerlyKnownAs", { names: "" }).replace(/[:\s]+$/, "");
  return (
    <details ref={ref} className="profile-formerly">
      <summary aria-label={label} title={label}>
        <FontAwesomeIcon icon={faChevronDown} />
      </summary>
      <ul className="profile-formerly__menu">
        {/* The three most recent (the API sends newest first), names only. */}
        {names.slice(0, 3).map((n) => <li key={n.username}>{n.username}</li>)}
      </ul>
    </details>
  );
}

/** "Last seen 3h ago" for the past month, "Last seen March 2019" before that. */
function lastSeenLabel(at: string, t: (k: string, o?: Record<string, unknown>) => string, lang: string): string {
  const days = (Date.now() - new Date(at).getTime()) / 86_400_000;
  return days < 30
    ? t("lastSeen", { when: timeAgo(at) })
    : t("lastSeenOn", { date: new Date(at).toLocaleDateString(lang, { year: "numeric", month: "long" }) });
}

registerBlock({
  type:   "profileIdentity",
  schema: blockPropSchemas.profileIdentity,
  editorMeta: { label: "Name & badges", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{
    showHandle: boolean; showJoined: boolean; showAge?: boolean; showBadges: boolean; showFormerly: boolean;
  }>) => {
    const { t, i18n } = useTranslation("profiles");
    const { profile } = context;
    const usesFullName = profile.namePreference === "fullName" && !!profile.displayName;
    const rankImages = useRankImages();
    const rankRow = profile.groups.filter((g) => g.key && rankImages.has(g.key));

    /**
     * ⚠ ONE meta line, joined with a separator — `@handle · Member since August 2026`.
     * The pieces were three stacked paragraphs, which pushed the pills a whole
     * block further down and broke the card's proportions against the mockup.
     */
    const joined = props.showJoined
      ? t("memberSince", {
          date: new Date(profile.joinedDate)
            .toLocaleDateString(i18n.language, { year: "numeric", month: "long" }),
        })
      : null;
    // Age or birthday, as the member allowed in Account → Privacy (null = neither).
    // ⚠ `showAge` is read as "not false": documents saved before the prop existed
    // carry no value, and `parseLayoutDocument` does not fill defaults.
    const dob = props.showAge !== false && profile.dob
      ? profile.dob.kind === "age"
        ? t("yearsOld", { count: profile.dob.age })
        : t("birthdayOn", {
            date: new Date(Date.UTC(2000, profile.dob.month - 1, profile.dob.day))
              .toLocaleDateString(i18n.language, { month: "long", day: "numeric", timeZone: "UTC" }),
          })
      : null;
    // "Member since September 2026, 20 years old" — one clause about the member, so
    // a comma; the @handle stays a separate piece behind the dot.
    const about = [joined, dob].filter(Boolean).join(", ");
    // Absent while they're online (the avatar's dot says so) or when they hide it.
    const lastSeen = profile.lastSeenAt ? lastSeenLabel(profile.lastSeenAt, t, i18n.language) : null;

    const meta = [
      props.showHandle && usesFullName ? `@${profile.username}` : null,
      about || null,
      lastSeen,
    ].filter(Boolean);

    return (
      <div className="profile-identity" data-mod-target={`user:${profile.id}`}>
        {/* The name and every pill share one wrapping row: the mockup reads the
            rank beside the name, not underneath it. */}
        <div className="profile-titlerow">
          <h1 className="profile-name">
            <Username
              username={usesFullName ? profile.displayName! : profile.username}
              badgeColor={profile.groups[0]?.badgeColor}
            />
          </h1>

          {props.showFormerly && profile.previousUsernames.length > 0 && (
            <FormerUsernames names={profile.previousUsernames} />
          )}

          {/* A ban notice is NOT covered by `showBadges`: it is a moderation state,
              not decoration, and an admin must not be able to hide it by unticking a
              badge option. */}
          {profile.isBanned ? (
            <span className="profile-badge profile-badge--banned">
              <FontAwesomeIcon icon={faLock} />
              {profile.isPermanentBan ? t("permanentlyBanned") : t("banned")}
            </span>
          ) : props.showBadges && profile.groups
            // A group with a rank image draws it on its own row under the name instead.
            .filter((g) => !(g.key && rankImages.has(g.key)))
            .map((g) => {
              const color = g.badgeColor ?? "var(--c-accent)";
              return (
                <span key={g.id} className="profile-badge"
                  style={{ background: `${color}20`, color, borderColor: `${color}40` }}>
                  {g.badgeLabel ?? g.name}
                </span>
              );
            })}
        </div>

        {/* Rank images (ACP → Settings → Rank display = images) sit UNDER the name: a
            160px banner beside it pushed the name row apart. Hidden while banned, like
            the badges, and by the same `showBadges` switch. */}
        {!profile.isBanned && props.showBadges && rankRow.length > 0 && (
          <div className="profile-rankimgs">
            {rankRow.map((g) => (
              <img key={g.id} className="xt-rankimg" src={rankImages.get(g.key!)} alt={g.badgeLabel ?? g.name}
                title={g.badgeLabel ?? g.name} loading="lazy" decoding="async" />
            ))}
          </div>
        )}

        {meta.length > 0 && <p className="profile-meta">{meta.join(" · ")}</p>}

      </div>
    );
  },
});

registerBlock({
  type:   "profileActions",
  schema: blockPropSchemas.profileActions,
  editorMeta: { label: "Follow & block", category: "data", ...ON_PROFILE },
  // Self-gating, exactly as the chrome blocks are: nothing to act on for a guest or
  // on one's own profile. The admin arranges WHERE, the block owns WHETHER.
  component: ({ context }: Ctx) => {
    const { t } = useTranslation("profiles");
    const { profile, isAuthenticated, onFollow, onBlockToggle, followPending, blockPending } = context;
    if (profile.isOwn || !isAuthenticated) return null;

    return (
      <div className="profile-actions">
        {/* Following needs the member's leave (Account → Privacy); unfollowing never does. */}
        {!profile.viewerHasBlocked && (profile.viewerIsFollowing || profile.viewerCan?.follow !== false) && (
          <button
            className={`profile-follow-btn${profile.viewerIsFollowing ? " profile-follow-btn--following" : ""}`}
            onClick={onFollow}
            disabled={followPending}
          >
            {profile.viewerIsFollowing ? t("following") : t("follow")}
          </button>
        )}

        {/* Plugin-contributed actions (e.g. messaging's PM button) keep working
            unchanged — they were already a slot, and this block is where the slot
            now lives. */}
        {!profile.viewerHasBlocked &&
          slotRegistry.getProfileActions().map((a) => (
            <a.component key={a.id} profileId={profile.id}
              profileUsername={profile.username} isOwn={profile.isOwn} />
          ))}

        <button
          className={`profile-icon-btn${profile.viewerHasBlocked ? " profile-icon-btn--active" : ""}`}
          onClick={onBlockToggle}
          disabled={blockPending}
          title={profile.viewerHasBlocked ? t("unblock") : t("block")}
          aria-label={profile.viewerHasBlocked ? t("unblock") : t("block")}
        >
          <FontAwesomeIcon icon={profile.viewerHasBlocked ? faUserCheck : faUserSlash} />
        </button>
      </div>
    );
  },
});

registerBlock({
  type:   "profileBio",
  schema: blockPropSchemas.profileBio,
  editorMeta: { label: "Bio", category: "data", ...ON_PROFILE },
  component: ({ context }: Ctx) => {
    const { t } = useTranslation("profiles");
    return <p className="profile-bio">{context.profile.bio || t("noBio")}</p>;
  },
});

registerBlock({
  type:   "profileStats",
  schema: blockPropSchemas.profileStats,
  editorMeta: { label: "Stats", category: "data", ...ON_PROFILE },
  // The rows come from the host, which is also what folds in plugin stat slots —
  // so a plugin's counter appears here without this block knowing plugins exist.
  component: ({ context }: Ctx) => (
    <div className="profile-stats">
      {context.stats.map(({ value, label, onClick }) => (
        <div key={label}
          className={`profile-stat${onClick ? " profile-stat--clickable" : ""}`}
          onClick={onClick}>
          <span className="profile-stat__value">{value.toLocaleString(uiLocale())}</span>
          <span className="profile-stat__label">{label}</span>
        </div>
      ))}
    </div>
  ),
});

/**
 * THE COVER — the band behind the top of a profile.
 *
 * A `section` would very nearly do this, and deliberately does not: a cover is the
 * one band whose whole job is to sit UNDER the avatar and the name, so the pieces
 * over it need something that reliably exists to overlap. Its background is composed
 * by the same helper `section` and `header` use, so the panel an admin gets is the
 * one they already know.
 *
 * ⚠ It draws a gradient from the site's palette when nothing is set, rather than
 * nothing at all. An empty cover is a band of dead space that reads as broken, and
 * a member who has uploaded no image is the normal case.
 */
/**
 * The owner's controls on their own cover.
 *
 * ⚠ A separate component, rendered ONLY when the profile is the viewer's own. It
 * holds the mutation hooks, and a hook cannot be conditional — inside the band block
 * itself, `useQueryClient` would run for every guest looking at any profile, making a
 * presentational band depend on mutation infrastructure it will never use.
 *
 * It covers the whole band so that dropping a file anywhere on the cover works,
 * rather than only onto a small rectangle.
 */
function CoverTools({ profile, progression }: {
  profile: { username: string; coverImage: string | null };
  progression: ProfileContext["progression"];
}) {
  const { t } = useTranslation("profiles");
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // ⚠ NOT gated on `progression.enabled`. The upload route enforces via
  // `getUserLimits`, which ignores the global progression toggle — so the gate is
  // reported even when the ladder is switched off, and reading `enabled` here would
  // offer an upload the server refuses.
  const mayUpload = progression?.canUploadCover !== false;
  const unlocksAt = progression?.coverUnlocksAt ?? null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", profile.username] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<{ url: string }>("/account/cover", fd);
    },
    onSuccess: () => { void refresh(); toast.success(t("cover.saved")); },
    onError:   (e) => toast.error(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete("/account/cover"),
    onSuccess:  () => { void refresh(); },
    onError:    (e) => toast.error(apiErrorMessage(e)),
  });

  const take = (file: File | undefined) => { if (file) upload.mutate(file); };

  return (
    <div
      className={`profile-cover__own${dragging ? " is-dragging" : ""}`}
      onDragOver={mayUpload ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={() => setDragging(false)}
      onDrop={mayUpload
        ? (e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }
        : undefined}
    >
      <input ref={fileInput} type="file" hidden
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => take(e.target.files?.[0] ?? undefined)} />

      {profile.coverImage ? (
        <div className="profile-cover__tools">
          <button type="button" className="profile-cover__btn"
            onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            <FontAwesomeIcon icon={faImage} /> {t("cover.change")}
          </button>
          <button type="button" className="profile-cover__btn"
            onClick={() => remove.mutate()} disabled={remove.isPending}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      ) : (
        /* The empty state is a DROPZONE, as drawn — an empty band with no invitation
           is the one thing a member cannot act on. */
        <div className="profile-cover__drop">
          <FontAwesomeIcon icon={faCloudArrowUp} className="profile-cover__drop-icon" />
          <div className="profile-cover__drop-title">
            {mayUpload ? t("cover.dropTitle") : t("cover.lockedTitle")}
          </div>
          <div className="profile-cover__drop-spec">{t("cover.spec")}</div>
          <div className="profile-cover__drop-actions">
            {mayUpload ? (
              <button type="button" className="profile-cover__cta"
                onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                <FontAwesomeIcon icon={faImage} /> {t("cover.upload")}
              </button>
            ) : (
              <span className="profile-cover__lock">
                <FontAwesomeIcon icon={faLock} />
                {unlocksAt ? t("cover.unlocksAt", { rank: unlocksAt }) : t("cover.unavailable")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

registerBlock({
  type:   "profileCover",
  schema: blockPropSchemas.profileCover,
  editorMeta: { surface: true, label: "Cover band", category: "structure", ...ON_PROFILE, wide: true },
  component: ({ props, context }: Ctx<{
    height: number; backgroundImage: string; backgroundGradient: string[]; backgroundAngle: number;
  }>) => {
    const { profile } = context;

    /**
     * ⚠ THREE layers, in this order: the member's own cover, then the band an admin
     * placed on the block, then the palette gradient. They are different things —
     * the block's `backgroundImage` is one image for EVERY profile on the site, and
     * a member's cover is theirs — so a member setting one must not be mistaken for
     * an admin changing the site.
     */
    const own        = profile.coverImage;
    const background = own ? `url(${own})` : sectionBackground(props);

    return (
      <div
        className={`profile-cover${background ? " profile-cover--bg" : ""}`}
        style={{ height: `${props.height ?? 220}px`, ...(background ? { backgroundImage: background } : {}) }}
      >
        {profile.isOwn && <CoverTools profile={profile} progression={context.progression} />}
      </div>
    );
  },
});

/**
 * RANK PROGRESS.
 *
 * ⚠ A thin wrapper. The rendering and the fetching live in
 * `features/progression/rank.tsx`, shared with the home rail's `homeProgression` —
 * there used to be two implementations of one concept, against two endpoints whose
 * shapes had already drifted.
 *
 * ⚠ NOT restricted to the profile. `useRankSubject` reads the profile from context
 * when there is one and falls back to the viewer, so an admin can put this anywhere
 * and it shows the reader their own standing.
 */
registerBlock({
  type:   "profileRank",
  schema: blockPropSchemas.profileRank,
  editorMeta: { label: "Rank progress", category: "data" },
  component: ({ props, context }: Ctx<{ showUnlocks: boolean }>) => {
    return <RankProgress data={useRankFor(context)} showUnlocks={props.showUnlocks} />;
  },
});

/**
 * THE AWARDS this member holds — and the ones they have not.
 *
 * ⚠ It draws its own data rather than reading `context`, because the SAME component
 * draws on an article author card and inside the forum's post card — surfaces with
 * no profile context at all. One implementation, batched into one request per page;
 * see `lib/userBadges.ts`.
 *
 * ⚠ The LOCKED marks are the point of the rail version. The mockup shows what is
 * still to earn beside what has been earned — a wall of four badges says nothing
 * about whether that is a lot. That needs the catalogue, which is why
 * `/user-badges/catalogue` is public.
 *
 * Self-gating: a site that has never created a badge renders nothing at all.
 */
registerBlock({
  type:   "profileBadges",
  schema: blockPropSchemas.profileBadges,
  editorMeta: { label: "Badges", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{ max: number; size: "sm" | "md" }>) => {
    const { t } = useTranslation("profiles");
    const { data: realEarned }    = useUserBadges(context.profile.id);
    const { data: realCatalogue } = useBadgeCatalogue();

    /**
     * ⚠ The catalogue and the awards are sampled TOGETHER or not at all. A sampled
     * catalogue beside real awards means no id can ever match, so every sample badge
     * draws locked and the count reads "0 of 8" — a grid that says the opposite of
     * what it is there to show.
     */
    const sampled   = realCatalogue?.length ? undefined : previewSample(SAMPLE_BADGES);
    const catalogue = realCatalogue?.length ? realCatalogue : sampled;
    if (!catalogue?.length) return null;

    const earned = sampled ? sampled.slice(0, 4) : realEarned;
    const held   = new Set((earned ?? []).map((b) => b.id));
    // Earned first, in card order, then the rest — the mockup fills the grid from
    // the top left with what has actually been won.
    const ordered = [
      ...catalogue.filter((b) => held.has(b.id)),
      ...catalogue.filter((b) => !held.has(b.id)),
    ];
    const shown  = ordered.slice(0, props.max);
    const hidden = ordered.length - shown.length;

    return (
      <div className="profile-awards">
        <div className="profile-rail__head">
          <span className="profile-rail__title">{t("badges.title")}</span>
          <span className="profile-awards__count">
            {t("badges.count", { held: held.size, total: catalogue.length })}
          </span>
        </div>

        <div className="profile-awards__grid">
          {shown.map((b) => {
            const has  = held.has(b.id);
            const note = (earned ?? []).find((e) => e.id === b.id)?.note;
            // Icon only; the name lives in the tooltip and the accessible name.
            const label = [b.name, has ? (note ?? b.description) : t("badges.locked")].filter(Boolean).join(" — ");
            return (
              <div key={b.id} className="profile-awards__cell" role="img" title={label} aria-label={label}>
                {has
                  ? <BadgeMark
                      badge={{ ...b, awardedAt: "", note: note ?? null, source: "manual" }}
                      size={props.size} />
                  : (
                    <span className={`xt-badge xt-badge--${props.size} xt-badge--locked`}>
                      <FontAwesomeIcon icon={faLock} />
                    </span>
                  )}
              </div>
            );
          })}

          {hidden > 0 && (
            <div className="profile-awards__cell" role="img" title={t("badges.seeAll")} aria-label={t("badges.seeAll")}>
              <span className={`xt-badge xt-badge--${props.size} xt-badge--locked`}>+{hidden}</span>
            </div>
          )}
        </div>
      </div>
    );
  },
});

/** A strip of followers, with the true total from the profile's own counter. */
registerBlock({
  type:   "profileFollowers",
  schema: blockPropSchemas.profileFollowers,
  editorMeta: { label: "Followers strip", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{ max: number }>) => {
    const { t } = useTranslation("profiles");
    const { profile, setTab } = context;
    // ⚠ Sample only on the EMPTY branch, and only for staff in the editor — the real
    // data always wins. See `previewSample`.
    const real      = context.followers?.items.length ? context.followers : null;
    const sample    = real ? undefined : previewSample(SAMPLE_FOLLOWERS);
    const followers = real ?? sample;
    if (!followers?.items.length) return null;

    /**
     * ⚠ The COUNT has to come from whichever source drew the avatars. For real data
     * that is the profile's own counter, not the strip's length — the strip is five
     * faces and the number is how many there really are. For a sample it must be the
     * sample's, or the editor shows five avatars beside a "0", which is a worse lie
     * than showing nothing.
     */
    const total = sample ? sample.total : profile.followerCount;

    return (
      <button type="button" className="profile-strip" onClick={() => setTab("followers")}>
        {/* Title with the chevron the mockup uses to say the card is a link. */}
        <span className="profile-rail__head">
          {/* ⚠ The PROFILE's counter, not the length of this strip — the strip is
              five avatars and the badge is how many there really are. */}
          <span className="profile-strip__label">
            <span className="profile-rail__title">{t("stat.followers")}</span>
            <span className="profile-strip__badge">{total.toLocaleString(uiLocale())}</span>
          </span>
          <FontAwesomeIcon icon={faChevronRight} className="profile-strip__more" />
        </span>
        <span className="profile-strip__row">
          <span className="profile-strip__avatars">
            {followers.items.slice(0, props.max ?? 5).map((u) => (
              <span key={u.id} className="profile-strip__av" title={u.username}>
                {u.avatar
                  ? <img src={u.avatar} alt="" />
                  : <em>{u.username.charAt(0).toUpperCase()}</em>}
              </span>
            ))}
          </span>
        </span>
      </button>
    );
  },
});

/**
 * RECENT VISITORS — the faces of who has looked at this profile lately.
 *
 * ⚠ Public, by the site's decision: the card sits in the rail every visitor sees, and
 * it names members only. A guest leaves no name, so a guest moves the total and
 * nothing else.
 *
 * Self-gating like the rest of the rail: a profile nobody has visited draws nothing
 * rather than an empty card with a zero in it.
 */
registerBlock({
  type:   "profileVisitors",
  schema: blockPropSchemas.profileVisitors,
  editorMeta: { label: "Recent visitors", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{ max: number }>) => {
    const { t } = useTranslation("profiles");
    const { data: real } = useProfileVisitors(context.profile.id, props.max ?? 5);
    const data = real?.items.length ? real : previewSample(SAMPLE_VISITORS);
    if (!data?.items.length) return null;

    // Faces and how many people they stand for; no "+N", no caption. The badge counts
    // named VISITORS, not `totalViews` — that includes guests and repeat visits, so it
    // would not be the number of people the faces are a sample of.
    return (
      <div className="profile-strip profile-strip--static">
        <span className="profile-rail__head">
          <span className="profile-strip__label">
            <span className="profile-rail__title">{t("visitors.title")}</span>
            <span className="profile-strip__badge">{data.visitors.toLocaleString(uiLocale())}</span>
          </span>
        </span>

        <span className="profile-strip__row">
          <span className="profile-strip__avatars">
            {data.items.map((u) => (
              <span key={u.id} className="profile-strip__av" title={u.username}>
                {u.avatar
                  ? <img src={u.avatar} alt="" />
                  : <em>{u.username.charAt(0).toUpperCase()}</em>}
              </span>
            ))}
          </span>
        </span>
      </div>
    );
  },
});

// ── Tabs and their bodies ───────────────────────────────────────────────────
// Two blocks, not one, even though they share state: the host owns `tab`, so the
// switcher and the body can sit in different regions and still agree. That is the
// whole reason interaction state lives in the host.

registerBlock({
  type:   "profileTabs",
  schema: blockPropSchemas.profileTabs,
  editorMeta: { label: "Profile tabs", category: "data", ...ON_PROFILE, wide: true },
  component: ({ context }: Ctx) => {
    return (
      <div className="profile-tabs">
        {context.tabs.map((item) => (
          <button key={item.id}
            className={`profile-tab${context.tab === item.id ? " profile-tab--active" : ""}`}
            onClick={() => context.setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    );
  },
});

registerBlock({
  type:   "profileContent",
  schema: blockPropSchemas.profileContent,
  editorMeta: { label: "Profile tab content", category: "data", ...ON_PROFILE, wide: true },
  component: ({ context }: Ctx) => {
    const { profile, tab, infoFields } = context;
    return (
      <div className="profile-content">
        {tab === "articles"    && <ProfileArticlesTab profile={profile} />}
        {tab === "wall"        && <ProfileWall profile={profile} />}
        {tab === "followers"   && <UserList userId={profile.id} type="followers" />}
        {tab === "following"   && <UserList userId={profile.id} type="following" />}
        {tab === "information" && <InformationTab profile={profile} fields={infoFields} />}
        {tab === "warnings"    && <WarningsTab profileId={profile.id} username={profile.username} isOwn={profile.isOwn} />}
        {slotRegistry.getProfileTabs().map((pt) =>
          tab === pt.id && (
            <pt.component key={pt.id} profileId={profile.id}
              profileUsername={profile.username} isOwn={profile.isOwn} />
          ),
        )}
      </div>
    );
  },
});
