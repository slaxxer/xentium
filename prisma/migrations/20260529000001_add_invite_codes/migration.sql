CREATE TABLE "invite_codes" (
  "id"            TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "note"          TEXT,
  "created_by_id" TEXT NOT NULL,
  "used_by_id"    TEXT,
  "used_at"       TIMESTAMP(3),
  "expires_at"    TIMESTAMP(3),
  "max_uses"      INTEGER NOT NULL DEFAULT 1,
  "use_count"     INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invite_codes_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "invite_codes_created_by"  FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invite_codes_used_by"     FOREIGN KEY ("used_by_id")    REFERENCES "User"("id") ON DELETE SET NULL  ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");
CREATE INDEX        "invite_codes_code_idx"  ON "invite_codes"("code");
