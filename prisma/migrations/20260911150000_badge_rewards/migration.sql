-- Badges can be EARNED, not only given.
--
-- ⚠ Off by default. A badge an admin creates is a badge an admin hands out; making
-- every new badge a reward would put the simpler and commoner case behind a switch.
ALTER TABLE "ncf_badges" ADD COLUMN "auto_award" BOOLEAN NOT NULL DEFAULT false;

-- The thresholds, as `{ "articles": 10, "forum.posts": 50 }`.
--
-- ⚠ JSON rather than columns, because the keys are EXTENSIBLE. A plugin contributes
-- its own metrics — the forum's posts and threads — and core cannot hold a column for
-- something it has never heard of. A key whose plugin is gone is simply not evaluated,
-- and comes back when the plugin does.
-- ⚠ ALL thresholds must be met, never any.
ALTER TABLE "ncf_badges" ADD COLUMN "criteria" JSONB NOT NULL DEFAULT '{}';

-- Which awards the sweep granted, as opposed to a person.
-- ⚠ An auto award is never taken back automatically: earning it was a fact about a
-- moment, and revoking because a like was deleted punishes a member for someone
-- else's action. An admin can still revoke by hand.
ALTER TABLE "ncf_user_badges" ADD COLUMN "auto" BOOLEAN NOT NULL DEFAULT false;
