-- Rename, not drop-and-recreate: an install's entitlement row is its proof of
-- what it may run, and re-issuing one requires reaching the marketplace. A
-- migration that emptied this table would leave every install unlicensed until
-- its next successful refresh — and offline ones indefinitely.
--
-- The table was called `ncf_licenses` and its reference column `license_key`.
-- Both names were wrong in a way that caused real bugs: the row holds the
-- signed entitlement DOCUMENT, which the marketplace issues even when an
-- account owns nothing, and the column holds a display reference, never a key
-- (the raw key never reaches an install at all). See the model comment in
-- schema.prisma.

ALTER TABLE "ncf_licenses" RENAME TO "ncf_entitlements";
ALTER TABLE "ncf_entitlements" RENAME COLUMN "license_key" TO "license_ref";

-- Constraint and index names do NOT follow a table rename in Postgres, and
-- Prisma derives the names it expects from the table and column — left alone,
-- the next `migrate dev` reports drift it wants to "fix".
--
-- These are still called `licenses_*` in the field: the table was created as
-- `licenses` and renamed to `ncf_licenses` by 20260612200000_ncf_table_prefix,
-- which renamed the table only. That is exactly the mistake being corrected
-- here, so both spellings are handled rather than assumed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licenses_pkey') THEN
    ALTER TABLE "ncf_entitlements" RENAME CONSTRAINT "licenses_pkey" TO "ncf_entitlements_pkey";
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncf_licenses_pkey') THEN
    ALTER TABLE "ncf_entitlements" RENAME CONSTRAINT "ncf_licenses_pkey" TO "ncf_entitlements_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'licenses_license_key_key') THEN
    ALTER INDEX "licenses_license_key_key" RENAME TO "ncf_entitlements_license_ref_key";
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ncf_licenses_license_key_key') THEN
    ALTER INDEX "ncf_licenses_license_key_key" RENAME TO "ncf_entitlements_license_ref_key";
  END IF;
END $$;
