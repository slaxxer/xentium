import { z } from "zod";

export const databaseConfigSchema = z.object({
  databaseUrl: z.string().url().optional()}) .default({});



export { siteConfigSchema, adminAccountSchema } from "@xentium/contracts";
