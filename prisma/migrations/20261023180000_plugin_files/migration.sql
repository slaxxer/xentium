-- Files add-ons store through host.files (ADR-0011).
CREATE TABLE "xcf_files" (
    "id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "kind" TEXT,
    "item_id" TEXT,
    "visibility" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB,
    "original_name" TEXT,
    "uploader_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xcf_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xcf_files_plugin_id_kind_item_id_idx" ON "xcf_files"("plugin_id", "kind", "item_id");
