/**
 * Privacy — every visibility choice on the account, in ONE list.
 *
 * ⚠ These used to be five accordions ("Birthday", "Links", "Profile Wall", "Follow &
 * Visibility", "Profile Visibility"), each holding one or two selects. Nobody asks
 * "what did I set under Follow & Visibility" — they ask "who can see my links", and
 * that question was answerable only by opening all five. One list, one row per
 * question.
 *
 * ⚠ It writes to FOUR endpoints (privacy settings, the profile's `dobDisplay`, the
 * birthday field, and every link field's privacy), which is why this tab has a save
 * bar rather than saving per row: half-applied privacy is the one kind of
 * half-applied state that actually matters.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { AccountCard, AccountRow, AccountSwitch } from "../components/AccountCard";
import { SaveBar } from "../components/SaveBar";

const LINK_KEYS = ["website", "github", "discord"];

export interface PrivacySettings {
  allowProfileComments?: boolean;
  whoCanComment?: "everyone" | "following" | "nobody";
  whoCanFollow?: "everyone" | "nobody";
  showFollowersPublic?: boolean;
  showFollowingPublic?: boolean;
  hideBlockedContent?: boolean;
  profileVisibility?: "everyone" | "members";
  postHistoryVisibility?: "everyone" | "members" | "nobody";
  displayNamePreference?: "username" | "fullName";
}

export const PRIVACY_DEFAULTS: Required<PrivacySettings> = {
  allowProfileComments: true,
  whoCanComment: "everyone",
  whoCanFollow: "everyone",
  showFollowersPublic: true,
  showFollowingPublic: true,
  hideBlockedContent: false,
  profileVisibility: "everyone",
  postHistoryVisibility: "everyone",
  displayNamePreference: "username",
};

type FieldPrivacy = "public" | "members" | "nobody";
type DobDisplay   = "hidden" | "age" | "birthday";

/** The whole form, so dirtiness is one comparison rather than nine flags. */
export interface Form {
  settings:        Required<PrivacySettings>;
  dobDisplay:      DobDisplay;
  dobVisibility:   FieldPrivacy;
  linksVisibility: FieldPrivacy;
}

/**
 * How many ANSWERS differ — the number the save bar shows.
 *
 * ⚠ Exported and pure so it can be tested: the bar's count is the page's main claim
 * about itself, and "3 unsaved changes" when only one thing moved is the kind of
 * wrongness nobody reports but everybody stops trusting.
 */
export function countPrivacyChanges(form: Form, saved: Form): number {
  let n = 0;
  for (const k of Object.keys(saved.settings) as (keyof PrivacySettings)[]) {
    if (form.settings[k] !== saved.settings[k]) n++;
  }
  if (form.dobDisplay      !== saved.dobDisplay)      n++;
  if (form.dobVisibility   !== saved.dobVisibility)   n++;
  if (form.linksVisibility !== saved.linksVisibility) n++;
  return n;
}

function Select<T extends string>({
  value, options, onChange, label,
}: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <select
      className="account-select"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function PrivacyTab() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: profileFields = [] } = useQuery({
    queryKey: ["account-profile-fields"],
    queryFn: () => api.get<Array<{ field: { id: string; key: string; label: string; type: string }; value: string; privacy: string }>>("/account/profile-fields"),
  });
  const { data: loaded } = useQuery({
    queryKey: ["account", "privacy"],
    queryFn: () => api.get<PrivacySettings>("/account/privacy"),
  });

  const dobField  = profileFields.find((e) => e.field.key === "date_of_birth");
  const linkRows  = useMemo(
    () => profileFields.filter((e) => LINK_KEYS.includes(e.field.key)),
    [profileFields],
  );

  /**
   * What the server says, as one object.
   *
   * ⚠ The save bar diffs against THIS, so it has to be derived from the responses
   * rather than captured once — the queries land at different times, and a baseline
   * taken on first render would read as "3 unsaved changes" before anyone touched a
   * control.
   */
  const saved: Form = useMemo(() => ({
    settings:        { ...PRIVACY_DEFAULTS, ...(loaded ?? {}) },
    dobDisplay:      user?.dobDisplay ?? "age",
    dobVisibility:   (dobField?.privacy as FieldPrivacy) ?? "public",
    linksVisibility: (linkRows[0]?.privacy as FieldPrivacy) ?? "public",
  }), [loaded, user?.dobDisplay, dobField?.privacy, linkRows]);

  const [form, setForm] = useState<Form>(saved);
  // Re-baseline while the form is untouched; once it is dirty, leave the edits alone.
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setForm(saved); }, [saved, touched]);

  const set = (patch: Partial<Form>) => { setTouched(true); setForm((f) => ({ ...f, ...patch })); };
  const setSetting = (patch: Partial<PrivacySettings>) =>
    set({ settings: { ...form.settings, ...patch } });

  const dirty = useMemo(() => countPrivacyChanges(form, saved), [form, saved]);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api.patch("/account/privacy", form.settings),
        api.patch("/account/profile", { dobDisplay: form.dobDisplay }),
        dobField
          ? api.patch("/account/profile-fields", {
              values: [{ fieldId: dobField.field.id, value: dobField.value, privacy: form.dobVisibility }],
            })
          : Promise.resolve(),
        // ⚠ Every link field carries its own privacy in the schema, but a member
        // decides about "my links" once — so one answer is written to all of them.
        linkRows.length > 0
          ? api.patch("/account/profile-fields", {
              values: linkRows.map((e) => ({
                fieldId: e.field.id, value: e.value, privacy: form.linksVisibility,
              })),
            })
          : Promise.resolve(),
      ]);
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, dobDisplay: form.dobDisplay });
      }
      void qc.invalidateQueries({ queryKey: ["account", "privacy"] });
      void qc.invalidateQueries({ queryKey: ["account-profile-fields"] });
      setTouched(false);
      toast.success(t("privacy.saved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("privacy.saveError")));
    } finally {
      setSaving(false);
    }
  }

  const WHO_FIELD = [
    { value: "public"  as FieldPrivacy, label: t("privacy.optEveryoneGuests") },
    { value: "members" as FieldPrivacy, label: t("privacy.optMembersOnly") },
    { value: "nobody"  as FieldPrivacy, label: t("privacy.optNobody") },
  ];

  return (
    <>
      <AccountCard title={t("privacy.whoTitle")} desc={t("privacy.whoDesc")}>
        <AccountRow
          wide
          label={t("privacy.rowProfile")}
          desc={t("privacy.rowProfileDesc")}
          control={
            <Select
              label={t("privacy.rowProfile")}
              value={form.settings.profileVisibility}
              options={[
                { value: "everyone", label: t("privacy.optEveryoneGuests") },
                { value: "members",  label: t("privacy.optLoggedInMembers") },
              ]}
              onChange={(v) => setSetting({ profileVisibility: v })}
            />
          }
        />

        {/* ⚠ TWO rows for the birthday, where the mockup had one: the visibility and
            the FORM it takes ("25 years old" vs "20 May") are separate answers, and
            the date itself is a profile field — it is edited on the Profile tab. */}
        <AccountRow
          wide
          label={t("privacy.rowBirthday")}
          desc={t("privacy.rowBirthdayDesc")}
          control={
            <Select
              label={t("privacy.rowBirthday")}
              value={form.dobVisibility}
              options={WHO_FIELD}
              onChange={(v) => set({ dobVisibility: v })}
            />
          }
        />
        <AccountRow
          wide
          label={t("privacy.dobDisplayLabel")}
          desc={t("privacy.dobDisplayDesc")}
          control={
            <Select
              label={t("privacy.dobDisplayLabel")}
              value={form.dobDisplay}
              options={[
                { value: "hidden"   as DobDisplay, label: t("privacy.dobHidden") },
                { value: "age"      as DobDisplay, label: t("privacy.dobAge") },
                { value: "birthday" as DobDisplay, label: t("privacy.dobBirthday") },
              ]}
              onChange={(v) => set({ dobDisplay: v })}
            />
          }
        />

        <AccountRow
          wide
          label={t("privacy.rowLinks")}
          desc={t("privacy.rowLinksDesc")}
          control={
            <Select
              label={t("privacy.rowLinks")}
              value={form.linksVisibility}
              options={WHO_FIELD}
              onChange={(v) => set({ linksVisibility: v })}
            />
          }
        />

        <AccountRow
          wide
          label={t("privacy.rowHistory")}
          desc={t("privacy.rowHistoryDesc")}
          control={
            <Select
              label={t("privacy.rowHistory")}
              value={form.settings.postHistoryVisibility}
              options={[
                { value: "everyone", label: t("privacy.optEveryone") },
                { value: "members",  label: t("privacy.optMembersOnly") },
                { value: "nobody",   label: t("privacy.optNobody") },
              ]}
              onChange={(v) => setSetting({ postHistoryVisibility: v })}
            />
          }
        />

        <AccountRow
          wide
          label={t("privacy.rowComment")}
          desc={t("privacy.rowCommentDesc")}
          control={
            <Select
              label={t("privacy.rowComment")}
              value={form.settings.whoCanComment}
              options={[
                { value: "everyone",  label: t("privacy.optEveryone") },
                { value: "following", label: t("privacy.optFollowing") },
                { value: "nobody",    label: t("privacy.optNobody") },
              ]}
              onChange={(v) => setSetting({ whoCanComment: v })}
            />
          }
        />

        <AccountRow
          wide
          label={t("privacy.rowFollow")}
          desc={t("privacy.rowFollowDesc")}
          control={
            <Select
              label={t("privacy.rowFollow")}
              value={form.settings.whoCanFollow}
              options={[
                { value: "everyone", label: t("privacy.optEveryone") },
                { value: "nobody",   label: t("privacy.optNobody") },
              ]}
              onChange={(v) => setSetting({ whoCanFollow: v })}
            />
          }
        />

        {/* Only worth asking when there is a full name to choose instead. */}
        {user?.displayName && (
          <AccountRow
            wide
            label={t("privacy.displayNameLabel")}
            desc={t("privacy.displayNameDesc")}
            control={
              <Select
                label={t("privacy.displayNameLabel")}
                value={form.settings.displayNamePreference}
                options={[
                  { value: "username", label: t("privacy.displayNameUsername") },
                  { value: "fullName", label: t("privacy.displayNameFull") },
                ]}
                onChange={(v) => setSetting({ displayNamePreference: v })}
              />
            }
          />
        )}
      </AccountCard>

      <AccountCard title={t("privacy.wallTitle")} desc={t("privacy.wallDesc")}>
        <AccountRow
          label={t("privacy.allowComments")}
          desc={t("privacy.allowCommentsDesc")}
          control={
            <AccountSwitch
              on={form.settings.allowProfileComments}
              label={t("privacy.allowComments")}
              onToggle={() => setSetting({ allowProfileComments: !form.settings.allowProfileComments })}
            />
          }
        />
        <AccountRow
          label={t("privacy.showFollowers")}
          desc={t("privacy.showFollowersDesc")}
          control={
            <AccountSwitch
              on={form.settings.showFollowersPublic}
              label={t("privacy.showFollowers")}
              onToggle={() => setSetting({ showFollowersPublic: !form.settings.showFollowersPublic })}
            />
          }
        />
        <AccountRow
          label={t("privacy.showFollowing")}
          desc={t("privacy.showFollowingDesc")}
          control={
            <AccountSwitch
              on={form.settings.showFollowingPublic}
              label={t("privacy.showFollowing")}
              onToggle={() => setSetting({ showFollowingPublic: !form.settings.showFollowingPublic })}
            />
          }
        />
        {/* A plugin's own privacy switch. ⚠ It saves ITSELF on click — a plugin
            cannot be enrolled in this tab's save bar, so it must not look like it
            is waiting for one. */}
        {slotRegistry.getPrivacySections().map((s) => <s.component key={s.id} />)}
      </AccountCard>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => { setTouched(false); setForm(saved); }}
      />
    </>
  );
}
