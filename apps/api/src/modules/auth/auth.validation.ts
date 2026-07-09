import { z } from "zod";

// The identifier is an email OR a username depending on auth.login_method; the
// service resolves the account. Accepts a legacy `email` field as a fallback so
// older clients keep working.
export const loginSchema = z.object({
  identifier: z.string().min(1).max(255).optional(),
  email: z.string().min(1).max(255).optional(),
  password: z.string().min(1),
  loginPin: z.string().regex(/^\d{4}$/).optional(),
}).refine((d) => !!(d.identifier ?? d.email), { message: "identifier required", path: ["identifier"] });
export type LoginInput = z.infer<typeof loginSchema>;

export const sendCodeSchema = z.object({
  email: z.string().email(),
});
export type SendCodeInput = z.infer<typeof sendCodeSchema>;

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
  fields: z
    .array(
      z.object({
        fieldId: z.string(),
        value: z.string(),
        privacy: z.enum(["public", "members", "nobody"]).default("public"),
      }),
    )
    .optional()
    .default([]),
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
