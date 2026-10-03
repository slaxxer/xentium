/**
 * Profile — everything a visitor sees about you, beside a preview of the result.
 *
 * ⚠ ONE save for the whole tab, not one per card. The bio, the links and the custom
 * fields were three forms with three buttons and three toasts, so filling in a
 * profile meant pressing Save three times and being told three times; miss one and
 * the work was gone. The save bar counts changed fields across all of them and
 * writes them together.
 *
 * ⚠ The photo is NOT part of that. An upload is an act, not a value — it is sent
 * the moment a file is chosen, because a picked file that waits for a Save is a file
 * people believe they already uploaded.
 *
 * ⚠ The preview is the real thing, drawn from the real account: the cover, the
 * avatar, the group badge, the join date and the counts all come from the server, so
 * it cannot flatter. Only the bio and the links follow what is being typed, because
 * those are the values on this page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faArrowUpFromBracket, faEye, faPuzzlePiece, faGlobe, faLink, faCodeBranch, faComments,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { useAuth } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { AccountCard, AccountRow } from "../components/AccountCard";
import { SaveBar } from "../components/SaveBar";
import { Username } from "../../../components/Username";
import { primaryBadgeColor } from "../../../lib/groupBadge";
import { RankBadge } from "../../../components/RankBadge";

interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: string;
  placeholder: string | null;
  dobDisplayFormat: string | null;
}

interface ProfileFieldEntry {
  field: FieldDef;
  value: string;
  privacy: "public" | "members" | "nobody";
}

const PRIVACY_OPTIONS = ["public", "members", "nobody"] as const;

/**
 * The three links get their own card, and their own glyphs.
 *
 * ⚠ Free SOLID icons, not brand marks: `@fortawesome/free-brands-svg-icons` is not a
 * dependency of this app, and pulling a whole icon pack in for two logos is not
 * worth the bundle. A site running a FontAwesome Pro kit gets the real marks
 * everywhere else through `TokenIcon`.
 */
const LINK_KEYS = ["website", "github", "discord"];
const LINK_ICONS: Record<string, IconDefinition> = {
  website: faGlobe, github: faCodeBranch, discord: faComments,
};

interface Entry { value: string; privacy: string }
type Values = Record<string, Entry>;

/** Bytes as a member reads them — the rank limit is stored in bytes. */
function readableSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${Math.round((bytes / 1_048_576) * 10) / 10} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function ProfileTab({ onGoTo }: { onGoTo?: (tab: "privacy") => void }) {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const { data: profileFields = [] } = useQuery<ProfileFieldEntry[]>({
    queryKey: ["account-profile-fields"],
    queryFn: () => api.get("/account/profile-fields"),
  });

  /** What this member's rank actually allows — the Photo hint states it. */
  const { data: limits } = useQuery<{ maxProfileImageBytes: number | null; allowedProfileImageTypes: string[] }>({
    queryKey: ["my-limits"],
    queryFn:  () => api.get("/users/me/limits"),
  });

  /** The public profile, for the preview's cover and counts. Same key the profile
   *  page uses, and the one this tab already invalidates after a save. */
  const { data: publicProfile } = useQuery<{ coverImage: string | null }>({
    queryKey: ["profile", user?.username],
    queryFn:  () => api.get(`/users/${user!.username}`),
    enabled:  !!user?.username,
  });

  // ── The form ──────────────────────────────────────────────────────────────

  const saved = useMemo(() => ({
    bio: user?.bio ?? "",
    values: Object.fromEntries(
      profileFields.map((e) => [e.field.id, { value: e.value, privacy: e.privacy }]),
    ) as Values,
  }), [user?.bio, profileFields]);

  const [bio, setBio]       = useState(saved.bio);
  const [values, setValues] = useState<Values>(saved.values);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving]   = useState(false);

  /**
   * ⚠ Re-baseline only while UNTOUCHED. The fields and the user land at different
   * times, so the form has to follow the server until someone types — and must
   * never be overwritten afterwards, which is what a plain `useEffect` on the data
   * would do the moment an unrelated query refetched.
   */
  useEffect(() => {
    if (touched) return;
    setBio(saved.bio);
    setValues(saved.values);
  }, [saved, touched]);

  const linkFields  = profileFields.filter((e) => LINK_KEYS.includes(e.field.key));
  const otherFields = profileFields.filter((e) => !LINK_KEYS.includes(e.field.key));

  const entry = (id: string): Entry => values[id] ?? saved.values[id] ?? { value: "", privacy: "public" };
  const setEntry = (id: string, patch: Partial<Entry>) => {
    setTouched(true);
    setValues((prev) => ({ ...prev, [id]: { ...entry(id), ...patch } }));
  };

  /** Changed FIELDS — bio counts as one, and a field counts once whether its value
   *  or its visibility moved. */
  const dirty = useMemo(() => {
    let n = bio !== saved.bio ? 1 : 0;
    for (const [id, e] of Object.entries(values)) {
      const was = saved.values[id];
      if (!was) continue;
      if (e.value !== was.value || e.privacy !== was.privacy) n++;
    }
    return n;
  }, [bio, values, saved]);

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<{ url: string }>("/account/avatar", fd);
    },
    onSuccess: (data) => {
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, avatar: data.url });
      }
      void qc.invalidateQueries({ queryKey: ["profile", user?.username] });
      toast.success(t("profile.photoUpdated"));
    },
    onError: (e) => {
      setAvatarPreview(null);   // the picked file was refused; stop showing it
      toast.error(apiErrorMessage(e, t("profile.uploadFailed")));
    },
  });

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    avatarMutation.mutate(file);
  }

  async function save() {
    setSaving(true);
    try {
      const fieldWrites = Object.entries(values)
        .filter(([id, e]) => {
          const was = saved.values[id];
          return was && (e.value !== was.value || e.privacy !== was.privacy);
        })
        .map(([fieldId, e]) => ({ fieldId, value: e.value, privacy: e.privacy }));

      // ⚠ Only what CHANGED is sent. Writing every field back would stamp a
      // privacy value onto fields the member never opened.
      await Promise.all([
        bio !== saved.bio
          ? api.patch<{ bio: string }>("/account/profile", { bio })
          : Promise.resolve(null),
        fieldWrites.length > 0
          ? api.patch("/account/profile-fields", { values: fieldWrites })
          : Promise.resolve(null),
      ]);

      if (bio !== saved.bio && authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, bio });
      }
      void qc.invalidateQueries({ queryKey: ["account-profile-fields"] });
      void qc.invalidateQueries({ queryKey: ["profile", user?.username] });
      setTouched(false);
      toast.success(t("profile.saved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("profile.saveError")));
    } finally {
      setSaving(false);
    }
  }

  // ── Pieces of the preview ─────────────────────────────────────────────────

  const initials  = user?.username ? user.username.slice(0, 2).toUpperCase() : "?";
  const avatarSrc = avatarPreview ?? user?.avatar ?? null;
  const linksVisibility = (linkFields[0]?.privacy ?? "public") as typeof PRIVACY_OPTIONS[number];

  const photoHint = limits?.maxProfileImageBytes
    ? t("profile.avatarHintLimit", { size: readableSize(limits.maxProfileImageBytes) })
    : t("profile.avatarHint");

  return (
    <div className="acct-profile">
      <div className="acct-profile__main">
        <AccountCard title={t("profile.photo")} desc={t("profile.photoDesc")}>
          <div className="acct-photo">
            <span className="acct-photo__avatar">
              {avatarSrc ? <img src={avatarSrc} alt={user?.username ?? ""} /> : initials}
            </span>
            <div className="acct-photo__side">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={pickFile}
              />
              <button
                type="button"
                className="acct-btn acct-btn--primary"
                onClick={() => fileInput.current?.click()}
                disabled={avatarMutation.isPending}
              >
                <FontAwesomeIcon className="acct-ic" icon={faArrowUpFromBracket} />
                {avatarMutation.isPending ? t("profile.uploading") : t("profile.uploadPhoto")}
              </button>
              {/* ⚠ No "Remove" button. There is no endpoint that clears an avatar —
                  a button that cannot do its job is worse than its absence. */}
              <span className="account-hint">{photoHint}</span>
            </div>
          </div>
        </AccountCard>

        <AccountCard title={t("profile.bioSection")} desc={t("profile.bioDesc")}>
          <textarea
            className="account-input account-input--textarea"
            value={bio}
            onChange={(e) => { setTouched(true); setBio(e.target.value); }}
            maxLength={500}
            rows={4}
            placeholder={t("profile.bioPlaceholder")}
            aria-label={t("profile.bioLabel")}
          />
          <div className="acct-undertext">
            <span className="account-hint">{t("profile.bioPlainOnly")}</span>
            <span className="acct-counter">{bio.length}/500</span>
          </div>
        </AccountCard>

        {linkFields.length > 0 && (
          <AccountCard
            title={t("profile.links")}
            desc={t("profile.linksDesc")}
            aside={
              // Says what the setting IS, and goes to where it is changed — the
              // links' visibility lives with every other visibility choice.
              <button type="button" className="acct-chiplink" onClick={() => onGoTo?.("privacy")}>
                <FontAwesomeIcon className="acct-ic" icon={faEye} />
                {t(`profile.linksVisible.${linksVisibility}`)}
              </button>
            }
          >
            {linkFields.map((e) => (
              <AccountRow
                key={e.field.id}
                variant="link"
                htmlFor={`lf-${e.field.id}`}
                label={e.field.label}
                control={
                  <span className="acct-inputwrap">
                    <FontAwesomeIcon className="acct-ic" icon={LINK_ICONS[e.field.key] ?? faLink} />
                    <input
                      id={`lf-${e.field.id}`}
                      className="account-input"
                      type={e.field.type === "url" ? "url" : "text"}
                      value={entry(e.field.id).value}
                      placeholder={e.field.placeholder ?? ""}
                      onChange={(ev) => setEntry(e.field.id, { value: ev.target.value })}
                    />
                  </span>
                }
              />
            ))}
          </AccountCard>
        )}

        {otherFields.length > 0 && (
          <AccountCard title={t("profile.profileInfo")} desc={t("profile.profileInfoDesc")}>
            {otherFields.map((e) => {
              const f = e.field;
              const cur = entry(f.id);
              /* ⚠ The birthday is one of these fields, not a special case: it is
                 stored as `date_of_birth` with its own privacy, so it belongs in
                 the list with the rest. Only its INPUT differs. */
              const isDob = f.key === "date_of_birth";
              return (
                <div key={f.id} className="acct-row acct-row--field">
                  <label className="acct-row__label" htmlFor={`pf-${f.id}`}>{f.label}</label>
                  <input
                    id={`pf-${f.id}`}
                    className="account-input"
                    type={isDob ? "date" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                    value={cur.value}
                    placeholder={f.placeholder ?? ""}
                    onChange={(ev) => setEntry(f.id, { value: ev.target.value })}
                  />
                  <select
                    className="account-select"
                    value={cur.privacy}
                    aria-label={t("profile.fieldVisibility", { label: f.label })}
                    onChange={(ev) => setEntry(f.id, { privacy: ev.target.value })}
                  >
                    {PRIVACY_OPTIONS.map((o) => (
                      <option key={o} value={o}>{t(`profile.privacyOpt.${o}`)}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </AccountCard>
        )}

        {/* A plugin's account section — the forum's signature is the reference one.
            ⚠ It carries its OWN save button inside, so the chip says where it comes
            from and the save bar below leaves it alone. */}
        {slotRegistry.getAccountSections().map((s) => (
          <AccountCard
            key={s.id}
            title={s.label}
            aside={<span className="acct-tag"><FontAwesomeIcon className="acct-ic" icon={faPuzzlePiece} />{t("profile.pluginTag")}</span>}
          >
            <s.component />
          </AccountCard>
        ))}

        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={() => void save()}
          onDiscard={() => { setTouched(false); setBio(saved.bio); setValues(saved.values); }}
        />
      </div>

      <aside className="acct-preview">
        <div className="acct-preview__card">
          <div className="acct-preview__head">
            <span>{t("profile.previewTitle")}</span>
            <span className="acct-preview__live"><i />{t("profile.previewPublic")}</span>
          </div>
          <div
            className="acct-preview__cover"
            style={publicProfile?.coverImage
              ? { backgroundImage: `url(${publicProfile.coverImage})` }
              : undefined}
          />
          <div className="acct-preview__body">
            <span className="acct-preview__avatar">
              {avatarSrc ? <img src={avatarSrc} alt="" /> : initials}
            </span>
            <div className="acct-preview__name">
              <strong><Username username={user?.displayName || user?.username || ""} badgeColor={primaryBadgeColor(user?.visibleGroups)} /></strong>
              {user?.visibleGroups?.[0] && (
                <RankBadge groupKey={user.visibleGroups[0].key} label={user.visibleGroups[0].badgeLabel ?? user.visibleGroups[0].name}>
                  <span
                    className="acct-preview__group"
                    style={{ "--badge-color": user.visibleGroups[0].badgeColor ?? "var(--c-accent)" } as React.CSSProperties}
                  >
                    {user.visibleGroups[0].badgeLabel ?? user.visibleGroups[0].name}
                  </span>
                </RankBadge>
              )}
            </div>
            <span className="acct-preview__handle">
              @{user?.username}
              {user?.createdAt && ` · ${t("profile.joined", {
                date: new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
              })}`}
            </span>
            <p className={`acct-preview__bio${bio.trim() ? "" : " is-empty"}`}>
              {bio.trim() || t("profile.previewNoBio")}
            </p>

            {/* ⚠ Only links that HAVE a value, and only while they are visible to
                someone — the preview claims to be the public view, so a hidden
                link appearing here would be the one lie it must not tell. */}
            {linksVisibility !== "nobody" && (
              <div className="acct-preview__links">
                {linkFields
                  .filter((e) => entry(e.field.id).value.trim())
                  .map((e) => (
                    <span key={e.field.id} className="acct-preview__link">
                      <FontAwesomeIcon className="acct-ic" icon={LINK_ICONS[e.field.key] ?? faLink} />
                      {entry(e.field.id).value.replace(/^https?:\/\//, "")}
                    </span>
                  ))}
              </div>
            )}

            <div className="acct-preview__stats">
              <span><strong>{user?.followerCount ?? 0}</strong>{t("profile.statFollowers")}</span>
              <span><strong>{user?.followingCount ?? 0}</strong>{t("profile.statFollowing")}</span>
              <span><strong>{user?.postCount ?? 0}</strong>{t("profile.statPosts")}</span>
            </div>
          </div>
        </div>
        <p className="account-hint">{t("profile.previewNote")}</p>
      </aside>
    </div>
  );
}
