import { z } from "zod";
import { DEFAULT_VARIANT, templateKeySchema, variantKeySchema } from "@nodevo/contracts";

/**
 * The template a request addresses.
 *
 * SHAPE only — an enum cannot be used here any more, because a plugin's template key
 * is not known at compile time. Whether the key names a template that exists is the
 * service's check (`assertTemplateKnown`), which can say so with a 422 that names it;
 * the schema's job is to keep anything that is not key-shaped out of a path segment.
 */
export const templateKeyParamSchema = z.object({
  templateKey: templateKeySchema,
});

/**
 * The variant a request addresses, read from `?variant=`.
 *
 * Absent or empty means the template default. Present means a key, validated as a
 * slug here so a malformed one is a 422 rather than a row nothing will ever read.
 */
export const variantQuerySchema = z.object({
  variant: z.union([z.literal(""), variantKeySchema]).optional()
    .transform((v) => v ?? DEFAULT_VARIANT),
});

/** The document itself is validated by `layoutDocumentSchema` in the service —
 *  one schema for the shape, so the API and the renderer can never disagree. */
export const saveDraftSchema = z.object({
  document: z.unknown(),
  /**
   * The revision the client read, for optimistic concurrency.
   *
   * Three distinct states, which is why it is nullable AND optional: a timestamp means
   * "I read that row", `null` means "there was no row", and ABSENT means "do not check"
   * — the last kept so a caller that has no way to have raced (a script, an import)
   * is not forced to invent a token.
   */
  baseVersion: z.string().datetime().nullish(),
});
