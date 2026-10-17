-- Per-person UI flags (a tour seen, the layout editor's Advanced mode).
ALTER TABLE "xcf_users" ADD COLUMN "ui_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
