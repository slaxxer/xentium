-- Legal documents replace custom pages. Terms, privacy, disclaimer and imprint
-- become a fixed set core owns (routes, footer links, ACP editor); the generic
-- Pages feature is removed.

CREATE TABLE "xcf_legal_documents" (
    "key" TEXT NOT NULL,
    "draft_body" JSONB,
    "body" JSONB,
    "published_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xcf_legal_documents_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "xcf_legal_documents" ADD CONSTRAINT "xcf_legal_documents_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "xcf_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry over: a page assigned to the terms / privacy / imprint slot becomes that
-- legal document. Its text is the draft either way; it stays live only if it was.
INSERT INTO "xcf_legal_documents" ("key", "draft_body", "body", "published_at", "updated_at")
SELECT
    substring(s."key" from 'pages\.slot\.(.*)$'),
    p."body",
    CASE WHEN p."status" = 'published' THEN p."body" END,
    CASE WHEN p."status" = 'published' THEN COALESCE(p."published_at", p."updated_at") END,
    CURRENT_TIMESTAMP
FROM "xcf_settings" s
JOIN "xcf_pages" p ON p."id" = (s."value" #>> '{}')
WHERE s."key" IN ('pages.slot.terms', 'pages.slot.privacy', 'pages.slot.imprint');

DELETE FROM "xcf_settings" WHERE "key" LIKE 'pages.slot.%';

-- Nav links that pointed at a page would now lead to a 404.
DELETE FROM "xcf_nav_items" WHERE "page_id" IS NOT NULL;
ALTER TABLE "xcf_nav_items" DROP CONSTRAINT IF EXISTS "xcf_nav_items_page_id_fkey";
DROP INDEX IF EXISTS "xcf_nav_items_page_id_idx";
ALTER TABLE "xcf_nav_items" DROP COLUMN "page_id";

-- The page.detail template and every per-page layout go with it.
DELETE FROM "xcf_layouts" WHERE "template_key" = 'page.detail';

-- page.manage / page.publish: group grants cascade. legal.manage is registered on
-- boot and granted to admin.
DELETE FROM "xcf_permissions" WHERE "key" IN ('page.manage', 'page.publish');

DROP TABLE "xcf_pages";
