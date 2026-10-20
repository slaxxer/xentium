-- Legal documents: which must be accepted, and re-acceptance rounds.
ALTER TABLE "xcf_legal_documents" ADD COLUMN "require_acceptance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "xcf_legal_documents" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "xcf_legal_documents" ADD COLUMN "reaccept_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "xcf_legal_documents" ADD COLUMN "reaccepted_at" TIMESTAMP(3);

-- Until now terms and the privacy policy were always the ones asked for.
UPDATE "xcf_legal_documents" SET "require_acceptance" = true WHERE "key" IN ('terms', 'privacy');

CREATE TABLE "xcf_legal_acceptances" (
    "user_id" TEXT NOT NULL,
    "document_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xcf_legal_acceptances_pkey" PRIMARY KEY ("user_id","document_key")
);
CREATE INDEX "xcf_legal_acceptances_document_key_revision_idx" ON "xcf_legal_acceptances"("document_key", "revision");
ALTER TABLE "xcf_legal_acceptances" ADD CONSTRAINT "xcf_legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Members who already accepted (one date for both documents) keep that, as revision 1.
INSERT INTO "xcf_legal_acceptances" ("user_id", "document_key", "revision", "accepted_at")
SELECT u."id", d."key", 1, u."legal_accepted_at"
FROM "xcf_users" u CROSS JOIN (VALUES ('terms'), ('privacy')) AS d("key")
WHERE u."legal_accepted_at" IS NOT NULL;
