import { z } from "zod";

export const manifestSchema = z.object({
  id:                 z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  name:               z.string().min(1),
  version:            z.string().regex(/^\d+\.\d+\.\d+/, "version must be semver"),
  vendor:             z.string().min(1),
  minNodevoVersion:   z.string().regex(/^\d+\.\d+/, "minNodevoVersion must be semver"),
  maxNodevoVersion:   z.string().regex(/^\d+\./, "maxNodevoVersion must be semver").optional(),
  licenseRequired:    z.boolean().default(false),
  permissions:        z.array(z.string()).default([]),
  migrations:         z.array(z.string()).default([]),
  entrypoints: z.object({
    server: z.string().optional(),
    web:    z.string().optional(),
  }).default({}),
});

export type PluginManifest = z.infer<typeof manifestSchema>;

export function validateManifest(raw: unknown): PluginManifest {
  return manifestSchema.parse(raw);
}
