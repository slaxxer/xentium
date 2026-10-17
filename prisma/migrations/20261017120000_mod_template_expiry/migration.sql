-- How long a warning from this template counts (warn templates only): 7d | 30d | 90d |
-- 180d | 365d | never, NULL = the site's default (ACP → Moderation settings). The
-- moderator who issues it does not choose; a holder of
-- moderation.warn.expiry.override may.
ALTER TABLE "xcf_moderation_templates" ADD COLUMN "warn_expiry" TEXT;

-- The shipped warn templates start with a length that fits the offence.
UPDATE "xcf_moderation_templates" AS t SET "warn_expiry" = d.expiry
FROM (VALUES
  ('warn.harassment', '180d'),
  ('warn.spam',       '90d'),
  ('warn.offTopic',   '30d'),
  ('warn.uncredited', '90d')
) AS d(key, expiry)
WHERE t."default_key" = d.key AND t."warn_expiry" IS NULL;
