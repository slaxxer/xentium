-- ncf_sessions is the fastest-growing table in the schema: the refresh token
-- rotates on every use and a rotation revokes the old row and inserts a new one,
-- so an active user adds ~96 rows/day. The new log-retention prune deletes dead
-- rows by last activity; without this index that is a daily seq scan.
CREATE INDEX "ncf_sessions_lastUsedAt_idx" ON "ncf_sessions"("lastUsedAt");
