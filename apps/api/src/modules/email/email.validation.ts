import { z } from "zod";
import { EMAIL_TEMPLATE_KEYS } from "../../infrastructure/email/email-templates.js";

export const templateKeyParamSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
});

export const saveTemplateSchema = z.object({
  // Generous but bounded: an HTML email body is legitimately a few KB, and an
  // unbounded field here would land straight in a TEXT column on every send.
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(64_000),
});

export const testSendSchema = z.object({
  to: z.string().trim().email(),
  key: z.enum(EMAIL_TEMPLATE_KEYS).default("smtp_test"),
});
