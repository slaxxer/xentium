-- Nav items can render in the navbar (default) or the footer (§page-system:
-- per-page footer/navbar placement choice).
ALTER TABLE "ncf_nav_items" ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'navbar';
