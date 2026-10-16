-- When the member was last here: written by the auth middleware at most every few
-- minutes, and brought over by the migration tools from the old site. Unlike the
-- sessions it used to be read from, it survives a sign-out.
ALTER TABLE "xcf_users" ADD COLUMN "last_seen_at" TIMESTAMP(3);

UPDATE "xcf_users" u SET "last_seen_at" = s.last
  FROM (SELECT "userId", max("lastUsedAt") AS last FROM "xcf_sessions" GROUP BY "userId") s
 WHERE s."userId" = u.id;
