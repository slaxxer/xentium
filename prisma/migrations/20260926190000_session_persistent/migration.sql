-- "Keep me signed in": a session that ends with the browser (false) or lasts 30 days (true).
ALTER TABLE "xcf_sessions" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT true;
