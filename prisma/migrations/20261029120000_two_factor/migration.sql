-- Two-factor sign-in with an authenticator app (TOTP).
ALTER TABLE "xcf_users" ADD COLUMN "totp_secret" TEXT;
ALTER TABLE "xcf_users" ADD COLUMN "totp_enabled_at" TIMESTAMP(3);
ALTER TABLE "xcf_users" ADD COLUMN "totp_last_step" INTEGER;
ALTER TABLE "xcf_users" ADD COLUMN "totp_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
