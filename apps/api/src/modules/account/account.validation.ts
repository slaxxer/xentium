import { z } from "zod";

export const updateProfileSchema = z.object({
  bio:             z.string().max(500).optional(),
  dobDisplay:      z.enum(["hidden", "age", "birthday"]).optional(),
  preferredLocale: z.enum(["en", "de", "es", "fr", "pt"]).nullable().optional(),
});

export const badgeVisibilitySchema = z.object({
  hidden: z.array(z.string()).max(100),
});

export const changeUsernameSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, - and _"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const privacySettingsSchema = z.object({
  allowProfileComments: z.boolean().optional(),
  whoCanComment: z.enum(["everyone", "following", "nobody"]).optional(),
  whoCanFollow: z.enum(["everyone", "nobody"]).optional(),
  showFollowersPublic: z.boolean().optional(),
  showFollowingPublic: z.boolean().optional(),
  hideBlockedContent: z.boolean().optional(),
  profileVisibility: z.enum(["everyone", "members"]).optional(),
  postHistoryVisibility: z.enum(["everyone", "members", "nobody"]).optional(),
  emailNotifications: z
    .object({
      forumActivity: z.boolean().optional(),
      follows: z.boolean().optional(),
      moderation: z.boolean().optional(),
      system: z.boolean().optional(),
      productNews: z.boolean().optional(),
    })
    .optional(),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const setPinSchema = z.object({
  currentPassword: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export const disablePinSchema = z.object({
  currentPassword: z.string().min(1),
});

export const changeEmailSchema = z.object({
  currentPassword: z.string().min(1),
  newEmail: z.string().email().max(254),
});

export const verifyEmailCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const boolObj = (keys: string[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])));

export const notificationPreferencesSchema = z.object({
  inApp: boolObj(["new_follower", "profile_activity", "mentions", "article_activity", "progression"]),
  email: boolObj(["new_follower", "profile_activity", "mentions"]),
});

export const profileFieldValuesSchema = z.object({
  values: z.array(
    z.object({
      fieldId: z.string(),
      value: z.string(),
      privacy: z.enum(["public", "members", "nobody"]).default("public"),
    }),
  ),
});
