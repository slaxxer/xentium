import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  loginPin: z.string().regex(/^\d{4}$/).optional(),
});
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
