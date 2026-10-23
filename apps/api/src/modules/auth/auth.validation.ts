import { z } from "zod";

// The identifier is an email OR a username depending on auth.login_method; the
// service resolves the account. Accepts a legacy `email` field as a fallback so
// older clients keep working.
export const loginSchema = z.object({
  identifier: z.string().min(1).max(255).optional(),
  email: z.string().min(1).max(255).optional(),
  password: z.string().min(1),
  loginPin: z.string().regex(/^\d{4}$/).optional(),
  /** "Keep me signed in". Absent = true, the behaviour every older client had. */
  remember: z.boolean().optional().default(true),
}).refine((d) => !!(d.identifier ?? d.email), { message: "identifier required", path: ["identifier"] });

/** The PIN step of a sign-in that already proved who it is (link, passkey, provider). */
export const pinStepSchema = z.object({
  ticket: z.string().min(16).max(128),
  pin:    z.string().regex(/^\d{4}$/),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const sendCodeSchema = z.object({
  email: z.string().email(),
});
export type SendCodeInput = z.infer<typeof sendCodeSchema>;

// Pre-flight availability probe for the registration wizard (step 1). Either
// field may be sent on its own — the response only reports what was asked for.
export const checkAvailabilitySchema = z.object({
  email: z.string().email().optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, - and _")
    .optional(),
}).refine((d) => !!(d.email || d.username), { message: "email or username required", path: ["username"] });
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;

export const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, numbers, - and _"),
  password: z.string().min(8).max(128),
  // Optional display / full name (enabled via registration.collect_name). Stored
  // as User.displayName; requirement is enforced in the service against settings.
  name: z.string().trim().max(80).optional(),
  emailCode: z.string().length(6, "Verification code must be 6 digits"),
  loginPinEnabled: z.boolean().optional().default(false),
  loginPin: z.string().regex(/^\d{4}$/).optional(),
  inviteCode: z.string().optional(),
  /** The sign-up form's "I accept the terms / privacy policy" box. Required while either is published. */
  acceptLegal: z.boolean().optional(),
  fields: z
    .array(
      z.object({
        fieldId: z.string(),
        value: z.string(),
        // Absent: the field's own default (ACP → Profile Fields).
        privacy: z.enum(["public", "members", "nobody"]).optional(),
      }),
    )
    .optional()
    .default([]),
  /**
   * What add-ons' own sign-up fields collected, by add-on id. Core stores none of it:
   * each add-on reads its part in its `registration.validate` filter and its
   * `user.registered` listener. Bounded: a sign-up is no place for a payload.
   */
  addons: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i), z.unknown())
    .refine((v) => Object.keys(v).length <= 20 && JSON.stringify(v).length <= 16_384, "Too much add-on data")
    .optional()
    .default({}),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

export const magicLinkRequestSchema = z.object({
  email:    z.string().email().max(255),
  remember: z.boolean().optional().default(true),
});

export const magicLinkConsumeSchema = z.object({
  token: z.string().min(20).max(128),
});

export const checkInviteSchema = z.object({ code: z.string().trim().min(1).max(64) });
