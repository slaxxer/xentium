-- PROFILE COVERS — the band behind a member's own profile header.
--
-- ⚠ Distinct from the `profileCover` BLOCK's background. That one is a layout prop an
-- admin sets once for every profile; this is personal, and it wins over the admin's
-- band when a member has set one.
ALTER TABLE "ncf_users" ADD COLUMN "cover_image" TEXT;

-- The rank gate the design calls for ("Unlocked at Contributor").
--
-- ⚠ DEFAULT TRUE. Covers did not exist before this column, so defaulting to false
-- would silently withhold a brand-new feature from every group on every existing
-- site, and an admin would have to discover the switch to give it back.
ALTER TABLE "ncf_group_progression"
    ADD COLUMN "can_upload_cover" BOOLEAN NOT NULL DEFAULT true;
