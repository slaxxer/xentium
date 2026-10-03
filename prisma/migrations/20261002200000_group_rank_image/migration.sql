-- A group's rank image, shown instead of its text badge when the site's rank
-- display is "images". Badges stay the default; nothing changes until an admin
-- uploads an image and switches the display over.
ALTER TABLE "xcf_groups" ADD COLUMN "rank_image" TEXT;
