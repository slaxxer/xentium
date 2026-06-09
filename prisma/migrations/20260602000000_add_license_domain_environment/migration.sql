-- ADR 0001: bind license entitlements to a domain + environment
ALTER TABLE "licenses" ADD COLUMN "domain" TEXT;
ALTER TABLE "licenses" ADD COLUMN "environment" TEXT;
