-- A warning counts for as long as its TEMPLATE says. The site-wide rule
-- (moderation.warning_expiry_enabled / _days) is retired: every warn template gets
-- its own length, taken from that rule so nothing changes for existing sites, and
-- the two settings are removed.
--
-- Templates that already have a length keep it. The others get the old site value:
-- "never" when expiry was switched off, otherwise the nearest of the lengths a
-- template offers (7, 30, 90, 180 or 365 days). No setting rows = the old defaults
-- (on, 90 days).
WITH site AS (
  SELECT
    COALESCE((SELECT (value)::text FROM "xcf_settings" WHERE key = 'moderation.warning_expiry_enabled'), 'true') <> 'false' AS enabled,
    COALESCE((SELECT NULLIF(trim(both '"' from (value)::text), '')::int FROM "xcf_settings" WHERE key = 'moderation.warning_expiry_days'), 90) AS days
), pick AS (
  SELECT CASE
    WHEN NOT site.enabled THEN 'never'
    ELSE (SELECT o.code FROM (VALUES (7, '7d'), (30, '30d'), (90, '90d'), (180, '180d'), (365, '365d')) AS o(d, code)
          ORDER BY abs(o.d - site.days), o.d LIMIT 1)
  END AS code
  FROM site
)
UPDATE "xcf_moderation_templates"
SET "warn_expiry" = (SELECT code FROM pick)
WHERE "mode" = 'warn' AND "warn_expiry" IS NULL;

DELETE FROM "xcf_settings" WHERE key IN ('moderation.warning_expiry_enabled', 'moderation.warning_expiry_days');
