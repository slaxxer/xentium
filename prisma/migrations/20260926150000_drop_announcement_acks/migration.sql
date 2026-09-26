-- Announcements vanish from the instance once read: the first admin's OK removes
-- the notice for the whole site, so there is no per-admin read log any more.
DROP TABLE IF EXISTS "xcf_announcement_acks";
