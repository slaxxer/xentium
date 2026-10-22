-- The member directory's sorts (most active, most followed, newest), active members only.
CREATE INDEX "xcf_users_isActive_post_count_idx" ON "xcf_users"("isActive", "post_count" DESC);
CREATE INDEX "xcf_users_isActive_follower_count_idx" ON "xcf_users"("isActive", "follower_count" DESC);
CREATE INDEX "xcf_users_isActive_createdAt_idx" ON "xcf_users"("isActive", "createdAt" DESC);
