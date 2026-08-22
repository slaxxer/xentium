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
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faUserSlash, faUserCheck } from "@fortawesome/free-solid-svg-icons";
import { useTranslation } from "react-i18next";
import { blockPropSchemas } from "@nodevo/contracts";
import { Username } from "../../components/Username";
import { slotRegistry } from "../../plugins/slotRegistry";
import { registerBlock, type BlockProps } from "../blockRegistry";
import {
  InformationTab,
  ProfileArticlesTab,
  ProfileWall,
  UserList,
  type ProfileContext,
} from "../../features/profiles/ProfilePage";

type Ctx<P = unknown> = BlockProps<P, ProfileContext>;

/** Every profile block needs a profile, so none is placeable anywhere else. */
const ON_PROFILE: { allowedTemplates: string[] } = { allowedTemplates: ["profile"] };

// ── The panel ───────────────────────────────────────────────────────────────

registerBlock({
  type:      "profileCard",
  schema:    blockPropSchemas.profileCard,
  container: true,
  editorMeta: { label: "Profile card", category: "structure", ...ON_PROFILE },
  component: ({ props, children }: Ctx<{ padding: string }>) => (
    <div className={`profile-card profile-card--pad-${props.padding}`}>{children}</div>
  ),
});

// ── The pieces ──────────────────────────────────────────────────────────────

registerBlock({
  type:   "profileAvatar",
  schema: blockPropSchemas.profileAvatar,
  editorMeta: { label: "Avatar", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{ size: string }>) => {
    const { profile } = context;
    return (
      <div className={`profile-av profile-av--${props.size}`}>
        {profile.avatar
          ? <img src={profile.avatar} alt={profile.username} />
          : <span>{profile.username.charAt(0).toUpperCase()}</span>}
      </div>
    );
  },
});

registerBlock({
  type:   "profileIdentity",
  schema: blockPropSchemas.profileIdentity,
  editorMeta: { label: "Name & badges", category: "data", ...ON_PROFILE },
  component: ({ props, context }: Ctx<{
    showHandle: boolean; showJoined: boolean; showBadges: boolean; showFormerly: boolean;
  }>) => {
    const { t } = useTranslation("profiles");
    const { profile } = context;
    const usesFullName = profile.namePreference === "fullName" && !!profile.displayName;

    return (
      <div className="profile-identity">
        <h1 className="profile-name">
          <Username
            username={usesFullName ? profile.displayName! : profile.username}
            badgeColor={profile.groups[0]?.badgeColor}
          />
        </h1>

        {props.showHandle && usesFullName && (
          <p className="profile-handle">@{profile.username}</p>
        )}

        {props.showFormerly && profile.previousUsernames.length > 0 && (
          <p className="profile-formerly">
            {t("formerlyKnownAs", { names: profile.previousUsernames.map((p) => p.username).join(", ") })}
          </p>
        )}

        {props.showJoined && (
          <p className="profile-joined">
            {t("memberSince", {
              date: new Date(profile.joinedDate)
                .toLocaleDateString(undefined, { year: "numeric", month: "long" }),
            })}
          </p>
        )}

        {/* A ban notice is NOT covered by `showBadges`: it is a moderation state,
            not decoration, and an admin must not be able to hide it by unticking a
            badge option. */}
        {profile.isBanned ? (
          <div className="profile-badges">
            <span className="profile-badge profile-badge--banned">
              <FontAwesomeIcon icon={faLock} />
              {profile.isPermanentBan ? t("permanentlyBanned") : t("banned")}
            </span>
          </div>
        ) : props.showBadges && profile.groups.length > 0 && (
          <div className="profile-badges">
            {profile.groups.map((g) => {
              const color = g.badgeColor ?? "var(--c-accent)";
              return (
                <span key={g.id} className="profile-badge"
                  style={{ background: `${color}20`, color, borderColor: `${color}40` }}>
                  {g.badgeLabel ?? g.name}
                </span>
              );
            })}
          </div>
        )}
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
        {!profile.viewerHasBlocked && (
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
          <span className="profile-stat__value">{value.toLocaleString()}</span>
          <span className="profile-stat__label">{label}</span>
        </div>
      ))}
    </div>
  ),
});

// ── Tabs and their bodies ───────────────────────────────────────────────────
// Two blocks, not one, even though they share state: the host owns `tab`, so the
// switcher and the body can sit in different regions and still agree. That is the
// whole reason interaction state lives in the host.

registerBlock({
  type:   "profileTabs",
  schema: blockPropSchemas.profileTabs,
  editorMeta: { label: "Profile tabs", category: "data", ...ON_PROFILE },
  component: ({ context }: Ctx) => (
    <div className="profile-tabs">
      {context.tabs.map((item) => (
        <button key={item.id}
          className={`profile-tab${context.tab === item.id ? " profile-tab--active" : ""}`}
          onClick={() => context.setTab(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
});

registerBlock({
  type:   "profileContent",
  schema: blockPropSchemas.profileContent,
  editorMeta: { label: "Profile tab content", category: "data", ...ON_PROFILE },
  component: ({ context }: Ctx) => {
    const { profile, tab, infoFields } = context;
    return (
      <div className="profile-content">
        {tab === "articles"    && <ProfileArticlesTab profile={profile} />}
        {tab === "wall"        && <ProfileWall profile={profile} />}
        {tab === "followers"   && <UserList userId={profile.id} type="followers" />}
        {tab === "following"   && <UserList userId={profile.id} type="following" />}
        {tab === "information" && <InformationTab profile={profile} fields={infoFields} />}
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
