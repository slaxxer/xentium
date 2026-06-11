-- Upsert core groups with correct singular names.
-- ON CONFLICT (key) handles both fresh DBs (insert) and existing ones (rename).
INSERT INTO "Group" (id, name, key, "isSystem", "createdAt")
VALUES
  (gen_random_uuid(), 'Administrator', 'admin',     true, NOW()),
  (gen_random_uuid(), 'Moderator',     'moderator', true, NOW()),
  (gen_random_uuid(), 'Member',        'member',    true, NOW())
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name;

-- Set badge colors and labels for admin group
INSERT INTO group_progression (group_id, badge_color, badge_label, updated_at)
SELECT id, '#f01919', 'Administrator', NOW()
FROM "Group" WHERE key = 'admin'
ON CONFLICT (group_id) DO UPDATE
  SET badge_color = EXCLUDED.badge_color,
      badge_label = EXCLUDED.badge_label,
      updated_at  = NOW();

-- Set badge colors and labels for moderator group
INSERT INTO group_progression (group_id, badge_color, badge_label, updated_at)
SELECT id, '#cd9e1d', 'Moderator', NOW()
FROM "Group" WHERE key = 'moderator'
ON CONFLICT (group_id) DO UPDATE
  SET badge_color = EXCLUDED.badge_color,
      badge_label = EXCLUDED.badge_label,
      updated_at  = NOW();
