import { z } from "zod";

/** Nothing to send: the database is the one in .env (the app's client is bound to
 *  it at startup). A URL here used to be accepted and silently ignored. */
export const databaseConfigSchema = z.object({}).strict().default({});



export { siteConfigSchema, adminAccountSchema } from "@xentium/contracts";
