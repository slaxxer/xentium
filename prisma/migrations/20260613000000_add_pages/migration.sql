-- Custom static pages (§page-system): title + TipTap body rendered at /p/:slug.
-- Own entity (not articles.type='page') so article queries/feeds stay clean.

CREATE TABLE "ncf_pages" (
    "id"              TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "slug"            TEXT NOT NULL,
    "body"            JSONB NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'draft',
    "visibility"      TEXT NOT NULL DEFAULT 'public',
    "seo_description" TEXT,
    "created_by_id"   TEXT,
    "published_at"    TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncf_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ncf_pages_slug_key" ON "ncf_pages"("slug");
CREATE INDEX "ncf_pages_status_idx" ON "ncf_pages"("status");

ALTER TABLE "ncf_pages"
    ADD CONSTRAINT "ncf_pages_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "ncf_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Nav coupling by reference: a nav item can point at a page (mirrors plugin_id).
ALTER TABLE "ncf_nav_items" ADD COLUMN "page_id" TEXT;

CREATE INDEX "ncf_nav_items_page_id_idx" ON "ncf_nav_items"("page_id");

ALTER TABLE "ncf_nav_items"
    ADD CONSTRAINT "ncf_nav_items_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "ncf_pages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
