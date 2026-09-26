-- Passkeys (WebAuthn) and linked sign-in providers.
CREATE TABLE "xcf_passkeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "xcf_passkeys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_passkeys_credential_id_key" ON "xcf_passkeys"("credential_id");
CREATE INDEX "xcf_passkeys_user_id_idx" ON "xcf_passkeys"("user_id");
ALTER TABLE "xcf_passkeys" ADD CONSTRAINT "xcf_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "xcf_oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "xcf_oauth_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "xcf_oauth_accounts_provider_provider_user_id_key" ON "xcf_oauth_accounts"("provider", "provider_user_id");
CREATE UNIQUE INDEX "xcf_oauth_accounts_user_id_provider_key" ON "xcf_oauth_accounts"("user_id", "provider");
CREATE INDEX "xcf_oauth_accounts_user_id_idx" ON "xcf_oauth_accounts"("user_id");
ALTER TABLE "xcf_oauth_accounts" ADD CONSTRAINT "xcf_oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
