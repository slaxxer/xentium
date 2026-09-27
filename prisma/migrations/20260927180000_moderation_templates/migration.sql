-- ModCanvas premade texts.
CREATE TABLE "xcf_moderation_templates" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rule_ref" TEXT,
    "default_duration" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "match_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "xcf_moderation_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xcf_moderation_templates_mode_deleted_at_idx" ON "xcf_moderation_templates"("mode", "deleted_at");

-- A starting set every site gets. Edit or delete them in ModCanvas → Templates.
INSERT INTO "xcf_moderation_templates" ("id", "mode", "name", "text", "default_duration", "internal", "match_categories") VALUES
  (gen_random_uuid()::text, 'warn', 'Harassment', 'Hi {user}, your {type} on {where} was reported for harassment. Personal attacks break our community rules. This is a formal warning, and further reports may lead to a ban.', NULL, false, ARRAY['harassment','abuse','insult','attack','rude']),
  (gen_random_uuid()::text, 'warn', 'Spam / self-promotion', 'Hi {user}, your {type} on {where} contains promotional links. Self-promotion isn''t allowed here. Please remove similar posts.', NULL, false, ARRAY['spam','advert','promotion','link']),
  (gen_random_uuid()::text, 'warn', 'Off-topic flooding', 'Hi {user}, repeated low-effort replies like the one on {where} disrupt threads for everyone. Please keep replies on topic.', NULL, false, ARRAY['off-topic','offtopic','flood','low effort']),
  (gen_random_uuid()::text, 'warn', 'Uncredited work', 'Hi {user}, your {type} on {where} uses someone else''s work without credit. Please credit the original creator or remove it.', NULL, false, ARRAY['credit','stolen','copied','plagiarism']),
  (gen_random_uuid()::text, 'ban', 'Repeated harassment', 'You have been banned for {duration} for repeated harassment after prior warnings. Your {type} on {where} was the deciding report.', '7d', false, ARRAY['harassment','abuse']),
  (gen_random_uuid()::text, 'ban', 'Spam account', 'This account has been banned for posting spam, including your {type} on {where}.', 'perm', false, ARRAY['spam','bot']),
  (gen_random_uuid()::text, 'ban', 'Ban evasion', 'This account is linked to a previously banned account and has been banned for ban evasion.', 'perm', false, ARRAY['evasion','alt','multi']),
  (gen_random_uuid()::text, 'ban', 'Phishing / impersonation', 'This account has been banned for impersonating staff and asking members for login details on {where}.', 'perm', false, ARRAY['phishing','impersonation','scam']),
  (gen_random_uuid()::text, 'ban', 'Hate speech', 'You have been banned for {duration} for hateful language in your {type} on {where}.', '30d', false, ARRAY['hate','racism','slur']),
  (gen_random_uuid()::text, 'delete', 'Removed: rule violation', 'Your {type} on {where} was removed because it breaks our community rules.', NULL, false, ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'delete', 'Removed: copyright', 'Your {type} on {where} was removed after a copyright report. You can post it again with credit or the creator''s permission.', NULL, false, ARRAY['copyright','dmca']),
  (gen_random_uuid()::text, 'dismiss', 'No violation found', 'Reviewed {type} on {where}. No rule broken.', NULL, true, ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'dismiss', 'Duplicate report', 'Duplicate of a report that was already handled.', NULL, true, ARRAY['duplicate']);
