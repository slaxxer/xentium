-- Unify the SMTP settings namespace.
--
-- The ACP wrote `email.smtp_host` / `email.smtp_port` / `email.from_address`,
-- but the sender (infrastructure/email/email.service.ts) has always read
-- `smtp.*`. Nothing ever read the `email.*` trio, so any admin who filled that
-- form in got no working mail and no error. Carry those values over to the keys
-- that are actually used, then drop the orphans.
--
-- ON CONFLICT DO NOTHING: if a deployment already configured the real `smtp.*`
-- keys directly, that configuration wins over the dead one.

INSERT INTO ncf_settings (key, value, "updatedAt")
SELECT 'smtp.host', value, NOW()
FROM ncf_settings
WHERE key = 'email.smtp_host' AND value::text NOT IN ('""', 'null')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ncf_settings (key, value, "updatedAt")
SELECT 'smtp.port', value, NOW()
FROM ncf_settings
WHERE key = 'email.smtp_port' AND value::text NOT IN ('""', 'null')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ncf_settings (key, value, "updatedAt")
SELECT 'smtp.from', value, NOW()
FROM ncf_settings
WHERE key = 'email.from_address' AND value::text NOT IN ('""', 'null')
ON CONFLICT (key) DO NOTHING;

DELETE FROM ncf_settings
WHERE key IN ('email.smtp_host', 'email.smtp_port', 'email.from_address');

-- Admin-editable email templates. Defaults live in code
-- (infrastructure/email/email-templates.ts); a row here overrides one key.
-- Absence is valid and means "use the shipped default", which is also what
-- Reset restores by deleting the row.
CREATE TABLE ncf_email_templates (
  key         TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT ncf_email_templates_pkey PRIMARY KEY (key)
);
