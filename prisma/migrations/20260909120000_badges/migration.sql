-- BADGES — awards an admin grants, and the third thing this codebase calls a badge.
--
-- The other two are derived and already exist: a GROUP badge is membership rendered
-- as a pill (`ncf_groups.display_order`, `ncf_users.hidden_badges`), and a RANK badge
-- is the ladder rung's label (`ncf_group_progression.badge_label`). Neither can carry
-- an award, because both answer "what is this user" rather than "what has this user
-- been given" — which is why this is its own table rather than another column there.
--
-- An icon is EITHER an uploaded file (`icon`, relative like "badges/x.png", bounded to
-- 32x32 at the route) OR a FontAwesome name (`fa_icon`) tinted with `color`. The file
-- wins when both are set, exactly as `ncf_groups.icon` beats its FontAwesome fallback.
CREATE TABLE "ncf_badges" (
    "id"            TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "icon"          TEXT,
    "fa_icon"       TEXT,
    "color"         TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "is_system"     BOOLEAN NOT NULL DEFAULT false,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncf_badges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ncf_badges_key_key" ON "ncf_badges"("key");

-- A badge is HELD, not accumulated: the primary key is the pair, so granting one
-- twice is the same badge rather than a second row to render beside the first.
--
-- `awarded_by_id` carries no foreign key on purpose — the award outlives the admin
-- who made it, and ON DELETE SET NULL would be a second way to say the same thing
-- while adding a constraint to a table read on every user card.
CREATE TABLE "ncf_user_badges" (
    "user_id"       TEXT NOT NULL,
    "badge_id"      TEXT NOT NULL,
    "awarded_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awarded_by_id" TEXT,
    "note"          TEXT,

    CONSTRAINT "ncf_user_badges_pkey" PRIMARY KEY ("user_id","badge_id")
);

-- Reading "who holds this badge" is the admin's view of a badge; the primary key
-- already serves the far commoner "what does this user hold".
CREATE INDEX "ncf_user_badges_badge_id_idx" ON "ncf_user_badges"("badge_id");

ALTER TABLE "ncf_user_badges" ADD CONSTRAINT "ncf_user_badges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "ncf_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ncf_user_badges" ADD CONSTRAINT "ncf_user_badges_badge_id_fkey"
    FOREIGN KEY ("badge_id") REFERENCES "ncf_badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
