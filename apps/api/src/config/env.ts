import { z } from 'zod';
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '../../.env') });

const schema = z.object({
  // Safe-by-default: an instance that never sets NODE_ENV runs as production
  // (strict rate limits, hidden error details, no dev auth backdoor, licensing
  // domain rules). Development is an explicit opt-in — ./xentium.sh exports it
  // and the dev checkout's .env carries NODE_ENV=development.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  REDIS_KEY_PREFIX: z.string().default("xentium:"),
  COOKIE_SECRET: z.string().min(16),
  JWT_SECRET: z.string().min(32),
  // HMAC key for refresh / password-reset / email-verify token hashing (§43).
  // Optional: falls back to JWT_SECRET when unset so existing installs still boot.
  REFRESH_TOKEN_HMAC_SECRET: z.string().min(32).optional(),
  DUMMY_ARGON2_HASH: z.string().min(1),
  UPLOAD_DIR: z.string().default("./var/uploads"),
  DATA_DIR: z.string().default("./data"),
  // Built SPA directory the API serves in production (with per-request SEO meta
  // injection). Unset → resolves to <REPO_ROOT>/apps/web/dist. When no build
  // exists (dev), the API skips web serving and Vite owns the frontend.
  WEB_DIST: z.string().optional(),
  // The Xentium marketplace every install talks to. Defaults to the hosted one so
  // a fresh install works out of the box; override per deployment to point at a
  // different marketplace. The base INCLUDES the protocol version (`/api/v1`),
  // which is also what every request signature covers — see protocol-client.
  LICENSE_SERVER_URL:      z.string().url().default("https://plugin.xentium.org/api/v1"),
  LICENSE_PUBLIC_KEY:      z.string().optional(),  // overrides the bundled entitlement-verification key (e.g. to point at a non-default license server); prod uses the bundled marketplace key
  // Where a HUMAN goes — the marketplace's storefront, for the links the ACP
  // shows an admin ("get a connect code", "free a seat"). Derived from
  // LICENSE_SERVER_URL by dropping the `/api/vN` suffix, which is correct in
  // production (nginx serves the SPA from the same origin) but not in dev,
  // where the API and the storefront run on different ports.
  MARKETPLACE_WEB_URL:     z.string().url().optional(),
  REPO_ROOT: z.string().default(path.resolve(process.cwd(), "../..")),
  PRISMA_SCHEMA_PATH: z.string().default(path.resolve(process.cwd(), "prisma/schema.prisma")),
  // When true, auto-installs + enables first-party plugins from plugins/official/
  // at startup. Default false so a fresh core starts with no forum until an admin
  // installs it on demand (ACP → Extensions). Set to "true" for the old dev flow.
  BOOTSTRAP_OFFICIAL_PLUGINS: z.string().default("false").transform((v) => v === "true" || v === "1"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {

  console.error(
    'Invalid environment:\n',
    JSON.stringify(parsed.error.format(), null, 2),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
