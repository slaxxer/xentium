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
