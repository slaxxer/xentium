-- Which shipped template a row is, by key rather than by its English name, so a
-- default can be shown in the site's language and still be recognised (Restore
-- defaults, "Default" marker) when its name is translated or edited.
ALTER TABLE "xcf_moderation_templates" ADD COLUMN "default_key" TEXT;

UPDATE "xcf_moderation_templates" AS t SET "default_key" = d.key
FROM (VALUES
  ('warn',    'harassment',               'warn.harassment'),
  ('warn',    'spam / self-promotion',    'warn.spam'),
  ('warn',    'off-topic flooding',       'warn.offTopic'),
  ('warn',    'uncredited work',          'warn.uncredited'),
  ('ban',     'repeated harassment',      'ban.repeatedHarassment'),
  ('ban',     'spam account',             'ban.spamAccount'),
  ('ban',     'ban evasion',              'ban.banEvasion'),
  ('ban',     'phishing / impersonation', 'ban.phishing'),
  ('ban',     'hate speech',              'ban.hateSpeech'),
  ('delete',  'removed: rule violation',  'delete.ruleViolation'),
  ('delete',  'removed: copyright',       'delete.copyright'),
  ('dismiss', 'no violation found',       'dismiss.noViolation'),
  ('dismiss', 'duplicate report',         'dismiss.duplicate')
) AS d(mode, name, key)
WHERE t."mode" = d.mode AND lower(trim(t."name")) = d.name AND t."deleted_at" IS NULL;
