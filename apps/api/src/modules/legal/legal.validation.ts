import { z } from "zod";
import { LEGAL_DOCUMENTS } from "@xentium/contracts";

// TipTap body — a ProseMirror doc. Loosely validated, same as articles: the
// editor extends over time and the server stores it as opaque JSON.
export const legalBodySchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.any()).optional(),
});

export const legalKeyParamSchema = z.object({
  key: z.enum(LEGAL_DOCUMENTS),
});

export const saveDraftSchema = z.object({
  draftBody: legalBodySchema,
});

export const acceptanceSchema = z.object({
  requireAcceptance: z.boolean(),
});

export const askAgainSchema = z.object({
  // Empty = every member.
  groupIds: z.array(z.string().min(1).max(64)).max(200),
});
