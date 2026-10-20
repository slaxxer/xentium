-- One install row, enforced. Two concurrent DATABASE steps could each insert one, with
-- different siteIds. Should an instance already have several, keep the completed one
-- (else the oldest), which is the row the site has been running on.
DELETE FROM "xcf_installs"
WHERE "id" <> (
  SELECT "id" FROM "xcf_installs"
  ORDER BY ("completedAt" IS NULL), "createdAt"
  LIMIT 1
);
ALTER TABLE "xcf_installs" ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "xcf_installs_singleton_key" ON "xcf_installs"("singleton");
