-- When a member accepted the site's terms / privacy policy. NULL = never: such a member
-- is asked once, on their next visit, before anything else (only while the site has
-- terms or a privacy policy published).
ALTER TABLE "xcf_users" ADD COLUMN "legal_accepted_at" TIMESTAMP(3);

-- Everyone who joined through the sign-up form already agreed there. Members brought
-- over by a migration tool and not signed in since (their password is still in the old
-- platform's format, or they have none yet) never saw this site's terms: they stay NULL.
UPDATE "xcf_users" SET "legal_accepted_at" = "createdAt"
 WHERE "password_scheme" = 'argon2' AND "passwordHash" NOT LIKE '!imported:%';
