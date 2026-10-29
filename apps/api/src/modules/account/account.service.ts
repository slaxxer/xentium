import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { hashPassword, verifyPassword } from "../auth/auth.password.js";
import { revokeSessionAccessToken } from "../auth/session-revocation.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { sendEmail } from "../../infrastructure/email/email.service.js";
import { renderEmailTemplate, siteVars } from "../../infrastructure/email/email-templates.js";
import { env } from "../../config/env.js";
import { recipientLocale } from "../../shared/i18n/serverText.js";
import { assertProfileFieldValues, choiceOptions, privacyFor } from "../users/profileFieldValues.js";
import { emit } from "../../core/events/events.js";
import { notificationTypeGroups, registeredType } from "../../core/plugin-platform/notificationTypes.js";
import { hasPermission } from "../../shared/middleware/requirePermission.js";

const USERNAME_COOLDOWN_DAYS_DEFAULT = 60;

async function getUsernameCooldownDays(): Promise<number> {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "users.username_change_cooldown_days" },
    });
    return setting ? Number((setting.value as any)) : USERNAME_COOLDOWN_DAYS_DEFAULT;
  } catch {
    return USERNAME_COOLDOWN_DAYS_DEFAULT;
  }
}

export const accountService = {
  async uploadAvatar(userId: string, fileBuffer: Buffer, ext: string): Promise<string> {
    const filename = `${userId}.${ext}`;
    const relPath = await storage.save("avatars", filename, fileBuffer);
    await prisma.user.update({
      where: { id: userId },
      data: { avatar: relPath },
    });
    emit("user.updated", { userId, fields: ["avatar"] });
    return storage.publicUrl(relPath);
  },

  /**
   * A member's own cover.
   *
   * Named after the user id, so setting a new one REPLACES the old file rather than
   * leaving it behind — a cover is singular, and the purge job should never have to
   * clean up after the normal case.
   *
   * ⚠ The extension comes from the magic-byte check, so changing format (png → gif)
   * leaves the previous file orphaned under a different extension. That IS the purge
   * job's case, and it collects `coverImage` now, so the old one goes.
   */
  async uploadCover(userId: string, fileBuffer: Buffer, ext: string): Promise<string> {
    const relPath = await storage.save("covers", `${userId}.${ext}`, fileBuffer);
    await prisma.user.update({ where: { id: userId }, data: { coverImage: relPath } });
    emit("user.updated", { userId, fields: ["coverImage"] });
    return storage.publicUrl(relPath);
  },

  /** Drop the cover and fall back to whatever the layout's block draws. */
  async removeCover(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { coverImage: null } });
    emit("user.updated", { userId, fields: ["coverImage"] });
  },

  async updateProfile(userId: string, data: {
    bio?: string; dobDisplay?: "hidden" | "age" | "birthday"; preferredLocale?: string | null;
  }) {
    const fields = (["bio", "dobDisplay", "preferredLocale"] as const).filter((k) => data[k] !== undefined);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.bio        !== undefined ? { bio: data.bio } : {}),
        ...(data.dobDisplay !== undefined ? { dobDisplay: data.dobDisplay } : {}),
        ...(data.preferredLocale !== undefined ? { preferredLocale: data.preferredLocale } : {}),
      },
      select: {
        id: true, username: true, bio: true, avatar: true, email: true,
        dobDisplay: true, preferredLocale: true,
      },
    });
    if (fields.length) emit("user.updated", { userId, fields: [...fields] });
    return updated;
  },

  async changeUsername(userId: string, newUsername: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const cooldownDays = await getUsernameCooldownDays();
    if (cooldownDays > 0 && user.usernameChangedAt) {
      const nextAllowed = new Date(user.usernameChangedAt);
      nextAllowed.setDate(nextAllowed.getDate() + cooldownDays);
      if (new Date() < nextAllowed) {
        throw new XentiumError({
          code: "XEC-USER-4010",
          httpStatus: 422,
          message: `Username can only be changed every ${cooldownDays} days`,
          details: { nextAllowedAt: nextAllowed.toISOString() },
        });
      }
    }

    const existing = await prisma.user.findFirst({
      where: { username: { equals: newUsername, mode: "insensitive" }, id: { not: userId } },
    });
    if (existing) {
      throw new XentiumError({ code: "XEC-USER-4011", httpStatus: 409, message: "Username is already taken" });
    }

    // Also check username history to prevent impersonation
    const inHistory = await prisma.usernameHistory.findFirst({
      where: { oldUsername: { equals: newUsername, mode: "insensitive" } },
    });
    if (inHistory && inHistory.userId !== userId) {
      throw new XentiumError({ code: "XEC-USER-4012", httpStatus: 409, message: "Username is already taken" });
    }

    await prisma.$transaction([
      prisma.usernameHistory.create({
        data: {
          userId,
          oldUsername: user.username,
          newUsername,
          changedById: userId,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { username: newUsername, usernameChangedAt: new Date() },
      }),
    ]);
    emit("user.updated", { userId, fields: ["username"] });

    return { username: newUsername };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const valid = await verifyPassword(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new XentiumError({ code: "XEC-AUTH-1001", httpStatus: 401, message: "Current password is incorrect" });
    }

    const newHash = await hashPassword(newPassword);

    // Collect the other active sessions up front so we can denylist their
    // in-flight access tokens too — the current session is intentionally kept.
    const others = await prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      select: { id: true },
    });

    // Delete all sessions except the current one
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      prisma.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    // Immediate revocation (BUGS.md #4): those other sessions' access tokens are
    // valid for up to 15 min otherwise. Current session untouched.
    await Promise.all(others.map((s) => revokeSessionAccessToken(s.id)));
  },

  /**
   * The member's live sessions, newest use first.
   *
   * ⚠ `currentSessionId` marks the one making the request. The account page needs to
   * say "this device" rather than offer to revoke the session the reader is using —
   * and only the server knows which row that is, since the id lives in the caller's
   * own token rather than in anything the browser can read back reliably.
   */
  async getSessions(userId: string, currentSessionId?: string) {
    const rows = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return rows.map((s) => ({ ...s, current: s.id === currentSessionId }));
  },

  async revokeSession(userId: string, sessionId: string) {
    const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new XentiumError({ code: "XEC-USER-4013", httpStatus: 404, message: "Session not found" });
    await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    // Immediate revocation (BUGS.md #4): kill this session's in-flight access token.
    await revokeSessionAccessToken(sessionId);
  },

  async getPrivacySettings(userId: string) {
    const row = await prisma.userPrivacySettings.upsert({
      where: { userId },
      create: { userId, settings: {} },
      update: {},
    });
    return row.settings ?? {};
  },

  async updatePrivacySettings(userId: string, settings: Record<string, unknown>) {
    const current = await prisma.userPrivacySettings.upsert({
      where: { userId },
      create: { userId, settings: {} },
      update: {},
    });
    const merged = { ...(current.settings as object), ...(settings as object) };
    await prisma.userPrivacySettings.update({
      where: { userId },
      data: { settings: merged as any },
    });
    emit("user.updated", { userId, fields: ["privacy"] });
    return merged;
  },

  async getProfileFieldValues(userId: string) {
    const [fields, values] = await Promise.all([
      prisma.userProfileField.findMany({ orderBy: { position: "asc" } }),
      prisma.userProfileFieldValue.findMany({ where: { userId } }),
    ]);
    const valueMap = new Map(values.map((v) => [v.fieldId, v]));
    return fields.map((f) => ({
      field: {
        id: f.id,
        key: f.key,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        dobDisplayFormat: f.dobDisplayFormat,
        helpText: f.helpText,
        maxLength: f.maxLength,
        options: choiceOptions(f.options),
        defaultPrivacy: f.defaultPrivacy,
      },
      value: valueMap.get(f.id)?.value ?? "",
      privacy: valueMap.get(f.id)?.privacy ?? f.defaultPrivacy,
    }));
  },

  async setLoginPin(userId: string, currentPassword: string, pin: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const valid = await verifyPassword(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new XentiumError({ code: "XEC-AUTH-1001", httpStatus: 401, message: "Current password is incorrect" });
    }

    if (user.totpEnabledAt) {
      throw new XentiumError({
        code: "XEC-AUTH-1076", httpStatus: 409,
        message: "Two-factor sign-in is on, and it replaces the login PIN.",
      });
    }

    const pinHash = await hashPassword(pin);
    await prisma.user.update({
      where: { id: userId },
      data: { loginPinEnabled: true, loginPinHash: pinHash },
    });
  },

  async disableLoginPin(userId: string, currentPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const valid = await verifyPassword(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new XentiumError({ code: "XEC-AUTH-1001", httpStatus: 401, message: "Current password is incorrect" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { loginPinEnabled: false, loginPinHash: null },
    });
  },

  async requestEmailChange(userId: string, currentPassword: string, newEmail: string, localeHint?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const valid = await verifyPassword(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new XentiumError({ code: "XEC-AUTH-1001", httpStatus: 401, message: "Current password is incorrect" });
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: newEmail, mode: "insensitive" }, id: { not: userId } },
    });
    if (existing) {
      throw new XentiumError({ code: "XEC-AUTH-2001", httpStatus: 409, message: "Email is already registered" });
    }

    await prisma.emailChangeToken.deleteMany({ where: { userId } });

    // 6-digit numeric code
    const code = String(Math.floor(100000 + crypto.randomInt(900000)));
    const tokenHash = crypto.createHmac("sha256", env.JWT_SECRET).update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.emailChangeToken.create({
      data: { userId, newEmail, tokenHash, expiresAt },
    });

    const { subject, html } = await renderEmailTemplate("email_change", {
      ...(await siteVars()),
      code,
      new_email: newEmail,
      expiry_minutes: "30",
    }, await recipientLocale({ userId, hint: localeHint }));
    await sendEmail(newEmail, subject, html);

    return { codeSent: true };
  },

  async verifyEmailCode(userId: string, code: string) {
    const tokenHash = crypto.createHmac("sha256", env.JWT_SECRET).update(code).digest("hex");
    const record = await prisma.emailChangeToken.findFirst({
      where: { userId, tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new XentiumError({ code: "XEC-AUTH-2003", httpStatus: 400, message: "Invalid or expired code" });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { email: record.newEmail } }),
      prisma.emailChangeToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    emit("user.emailChanged", { userId: record.userId });

    return { email: record.newEmail };
  },

  async updateProfileFieldValues(
    userId: string,
    values: Array<{ fieldId: string; value: string; privacy?: string }>,
  ) {
    await assertProfileFieldValues(values);
    const privacy = await privacyFor(values);
    await Promise.all(
      values.map((v) =>
        prisma.userProfileFieldValue.upsert({
          where: { userId_fieldId: { userId, fieldId: v.fieldId } },
          update: { value: v.value, ...(v.privacy ? { privacy: v.privacy } : {}) },
          create: { userId, fieldId: v.fieldId, value: v.value, privacy: privacy.get(v.fieldId)! },
        }),
      ),
    );
    emit("user.updated", { userId, fields: ["profileFields"] });
    const [fields, updated] = await Promise.all([
      prisma.userProfileField.findMany({ orderBy: { position: "asc" } }),
      prisma.userProfileFieldValue.findMany({ where: { userId } }),
    ]);
    const valueMap = new Map(updated.map((v) => [v.fieldId, v]));
    return fields.map((f) => ({
      field: {
        id: f.id, key: f.key, label: f.label, type: f.type, placeholder: f.placeholder, dobDisplayFormat: f.dobDisplayFormat,
        helpText: f.helpText, maxLength: f.maxLength, options: choiceOptions(f.options), defaultPrivacy: f.defaultPrivacy,
      },
      value: valueMap.get(f.id)?.value ?? "",
      privacy: valueMap.get(f.id)?.privacy ?? f.defaultPrivacy,
    }));
  },

  // ── Notification preferences ─────────────────────────────────────────────
  // Patterns are matched against dispatched notification types via prefix matching.
  // Only covers types that are actually dispatched today.

  NOTIF_PATTERN_MAP: {
    new_follower:     "social.*",      // social.new_follower
    profile_activity: "profile.*",     // profile.comment_posted, profile.comment_liked
    mentions:         "mention.*",     // mention.profile_comment  (was "mention" — broken)
    article_activity: "article.*",     // article.comment_liked
    progression:      "progression.*", // progression.promoted
    badges:           "badge.*",       // badge.earned  (the nightly award sweep)
  } as Record<string, string>,

  async getNotificationPreferences(userId: string) {
    const rows = await prisma.notificationPreference.findMany({ where: { userId } });
    const byPattern = new Map(rows.map((r) => [r.typePattern, r]));
    const m = accountService.NOTIF_PATTERN_MAP;
    return {
      inApp: {
        new_follower:     byPattern.get(m.new_follower!)?.inAppEnabled     ?? true,
        profile_activity: byPattern.get(m.profile_activity!)?.inAppEnabled ?? true,
        mentions:         byPattern.get(m.mentions!)?.inAppEnabled         ?? true,
        article_activity: byPattern.get(m.article_activity!)?.inAppEnabled ?? true,
        progression:      byPattern.get(m.progression!)?.inAppEnabled      ?? true,
        badges:           byPattern.get(m.badges!)?.inAppEnabled           ?? true,
      },
      email: {
        new_follower:     byPattern.get(m.new_follower!)?.emailEnabled     ?? false,
        profile_activity: byPattern.get(m.profile_activity!)?.emailEnabled ?? false,
        mentions:         byPattern.get(m.mentions!)?.emailEnabled         ?? false,
      },
      // Add-ons' own types, each a switch the member can turn off. A type for staff
      // (`permission`) shows only to members holding it.
      addons: (await Promise.all(notificationTypeGroups().map(async (g) => ({
        pluginId: g.pluginId,
        name: g.name,
        types: (await Promise.all(g.types.map(async (t) =>
          t.permission && !(await hasPermission(userId, t.permission as never)) ? null : {
            type: t.type, label: t.label, description: t.description, emailOffered: t.email,
            inApp: byPattern.get(t.type)?.inAppEnabled ?? true,
            email: t.email ? byPattern.get(t.type)?.emailEnabled ?? false : false,
          }))).filter((t): t is NonNullable<typeof t> => t !== null),
      })))).filter((g) => g.types.length),
    };
  },

  async updateNotificationPreferences(
    userId: string,
    prefs: {
      inApp: Record<"new_follower"|"profile_activity"|"mentions"|"article_activity"|"progression"|"badges", boolean>;
      email: Record<"new_follower"|"profile_activity"|"mentions", boolean>;
      addons?: Record<string, { inApp: boolean; email: boolean }>;
    },
  ) {
    const m = accountService.NOTIF_PATTERN_MAP;
    const updates: Record<string, { inApp: boolean; email: boolean }> = {
      [m.new_follower!]:     { inApp: prefs.inApp.new_follower,     email: prefs.email.new_follower },
      [m.profile_activity!]: { inApp: prefs.inApp.profile_activity, email: prefs.email.profile_activity },
      [m.mentions!]:         { inApp: prefs.inApp.mentions,         email: prefs.email.mentions },
      [m.article_activity!]: { inApp: prefs.inApp.article_activity, email: false },
      [m.progression!]:      { inApp: prefs.inApp.progression,      email: false },
      // No email column: a badge is a thing you find on your profile, not post.
      [m.badges!]:           { inApp: prefs.inApp.badges,           email: false },
    };
    // Add-on types: only ones an enabled add-on declared, and email only where it offers it.
    for (const [type, v] of Object.entries(prefs.addons ?? {})) {
      const known = registeredType(type);
      if (!known) continue;
      updates[type] = { inApp: v.inApp, email: known.email ? v.email : false };
    }
    await prisma.$transaction(
      Object.entries(updates).map(([typePattern, { inApp, email }]) =>
        prisma.notificationPreference.upsert({
          where:  { userId_typePattern: { userId, typePattern } },
          update: { inAppEnabled: inApp, emailEnabled: email },
          create: { userId, typePattern, inAppEnabled: inApp, emailEnabled: email },
        }),
      ),
    );
    return accountService.getNotificationPreferences(userId);
  },

  /**
   * Badge visibility (Account → Preferences). Returns every group the user
   * belongs to, ordered by badge precedence (Group.displayOrder), with a
   * `visible` flag derived from `User.hiddenBadges`.
   */
  async getBadgeVisibility(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hiddenBadges: true },
    });
    if (!user) throw new XentiumError({ code: "XEC-USER-1001", httpStatus: 404, message: "User not found" });

    const memberships = await prisma.userGroup.findMany({
      where: { userId },
      include: {
        group: {
          include: { progression: { select: { badgeColor: true, badgeLabel: true } } },
        },
      },
    });
    const hidden = new Set(user.hiddenBadges);

    return memberships
      .slice()
      .sort((a, b) => (a.group.displayOrder ?? 100) - (b.group.displayOrder ?? 100))
      .map((m) => ({
        id:           m.group.id,
        name:         m.group.name,
        key:          m.group.key,
        displayOrder: m.group.displayOrder,
        badgeLabel:   m.group.progression?.badgeLabel ?? null,
        badgeColor:   m.group.progression?.badgeColor ?? null,
        visible:      !hidden.has(m.group.id),
      }));
  },

  /**
   * Persist which badges the user hides. `hidden` is sanitised to group IDs the
   * user actually belongs to, so a stale/foreign ID can never be stored.
   */
  async updateBadgeVisibility(userId: string, hidden: string[]) {
    const memberships = await prisma.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const ownGroupIds = new Set(memberships.map((m) => m.groupId));
    const sanitised = [...new Set(hidden)].filter((id) => ownGroupIds.has(id));

    await prisma.user.update({
      where: { id: userId },
      data: { hiddenBadges: sanitised },
    });
    return accountService.getBadgeVisibility(userId);
  },
};
