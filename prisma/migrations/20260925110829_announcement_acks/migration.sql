-- One administrator has seen one broadcast from the Xentium team.
--
-- Per admin rather than per site (the dialog interrupts a person), and stored
-- here rather than in browser storage so clicking OK on a laptop also answers
-- it on a phone.
--
-- No foreign key to an announcement: the announcements themselves are the
-- marketplace's records, cached in a setting, and this instance is only their
-- reader.
CREATE TABLE "xcf_announcement_acks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "acked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xcf_announcement_acks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xcf_announcement_acks_user_id_idx" ON "xcf_announcement_acks"("user_id");

CREATE UNIQUE INDEX "xcf_announcement_acks_user_id_announcement_id_key" ON "xcf_announcement_acks"("user_id", "announcement_id");

ALTER TABLE "xcf_announcement_acks" ADD CONSTRAINT "xcf_announcement_acks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "xcf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
