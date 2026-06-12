import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config();

// A fresh clone has no .env yet — the install wizard writes it on first run.
// `prisma generate` never connects to a database, so it must work without
// DATABASE_URL. Commands that do connect (migrate, studio) read the real URL
// from the environment; with the placeholder they fail with a clear
// connection error instead of a config-load crash.
const PLACEHOLDER_URL = "postgresql://unconfigured:unconfigured@localhost:5432/nodevo_unconfigured";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? PLACEHOLDER_URL },
});
