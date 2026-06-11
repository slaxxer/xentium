CREATE TABLE "beta_codes" (
  "id"            TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "note"          TEXT,
  "created_by_id" TEXT NOT NULL,
  "redeemer_ip"   TEXT,
  "redeemer_ua"   TEXT,
  "redeemed_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "beta_codes_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "beta_codes_created_by" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "beta_codes" ADD COLUMN "registered_user_id" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "beta_codes_code_key" ON "beta_codes"("code");
CREATE INDEX        "beta_codes_code_idx"  ON "beta_codes"("code");
