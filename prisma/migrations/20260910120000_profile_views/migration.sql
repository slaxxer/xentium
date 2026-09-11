-- PROFILE VIEWS — who looked at whose profile.
--
-- ⚠ ONE ROW PER PAIR, refreshed rather than appended to. The card answers "who has
-- been here lately"; a row per page load would make that a list of one person who
-- pressed reload, and would grow without bound on a busy profile.
--
-- Only a logged-in, non-owner visit writes here. A guest has no identity to record,
-- so a guest bumps `ncf_users.profile_view_count` and nothing else — and looking at
-- your own profile counts as neither.
CREATE TABLE "ncf_profile_views" (
    "profile_id" TEXT NOT NULL,
    "viewer_id"  TEXT NOT NULL,
    "viewed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visits"     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ncf_profile_views_pkey" PRIMARY KEY ("profile_id","viewer_id")
);

-- The card's only query, and the prune job's: this profile's visitors, newest first.
CREATE INDEX "ncf_profile_views_profile_id_viewed_at_idx"
    ON "ncf_profile_views"("profile_id", "viewed_at" DESC);

ALTER TABLE "ncf_profile_views" ADD CONSTRAINT "ncf_profile_views_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "ncf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ncf_profile_views" ADD CONSTRAINT "ncf_profile_views_viewer_id_fkey"
    FOREIGN KEY ("viewer_id") REFERENCES "ncf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- All-time views INCLUDING guests, deduped per IP exactly as article views are.
-- ⚠ Deliberately not a count over the table above: that one holds only named
-- visitors and is pruned on a schedule, so counting it would make a profile's total
-- shrink over time.
ALTER TABLE "ncf_users" ADD COLUMN "profile_view_count" INTEGER NOT NULL DEFAULT 0;
