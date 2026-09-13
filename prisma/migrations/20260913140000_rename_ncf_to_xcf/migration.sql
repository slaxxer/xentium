-- Nodevo -> Xentium: the core table prefix.
--
-- `ncf_` was "Nodevo Community Framework". Renaming it is only cheap while no
-- installation holds data worth migrating, which is true exactly now.
--
-- Tables first, then the constraints and indexes that carry the old prefix in
-- their own names. Constraint naming in this schema is already mixed — older
-- tables have `article_categories_pkey`, newer ones `ncf_acp_visits_pkey` —
-- and Prisma has always tolerated that, so only the prefixed ones move.
--
-- The plugin bookkeeping table `nodevo_plugin_migrations` is deliberately NOT
-- renamed: see docs/rename-to-xentium.md.

-- Tables
ALTER TABLE ncf_acp_visits RENAME TO xcf_acp_visits;
ALTER TABLE ncf_activity_log RENAME TO xcf_activity_log;
ALTER TABLE ncf_article_categories RENAME TO xcf_article_categories;
ALTER TABLE ncf_article_comment_likes RENAME TO xcf_article_comment_likes;
ALTER TABLE ncf_article_comments RENAME TO xcf_article_comments;
ALTER TABLE ncf_article_dislikes RENAME TO xcf_article_dislikes;
ALTER TABLE ncf_article_likes RENAME TO xcf_article_likes;
ALTER TABLE ncf_article_revisions RENAME TO xcf_article_revisions;
ALTER TABLE ncf_article_tags RENAME TO xcf_article_tags;
ALTER TABLE ncf_articles RENAME TO xcf_articles;
ALTER TABLE ncf_badges RENAME TO xcf_badges;
ALTER TABLE ncf_beta_access_log RENAME TO xcf_beta_access_log;
ALTER TABLE ncf_beta_codes RENAME TO xcf_beta_codes;
ALTER TABLE ncf_email_change_tokens RENAME TO xcf_email_change_tokens;
ALTER TABLE ncf_email_templates RENAME TO xcf_email_templates;
ALTER TABLE ncf_entitlements RENAME TO xcf_entitlements;
ALTER TABLE ncf_error_log RENAME TO xcf_error_log;
ALTER TABLE ncf_group_permissions RENAME TO xcf_group_permissions;
ALTER TABLE ncf_group_progression RENAME TO xcf_group_progression;
ALTER TABLE ncf_groups RENAME TO xcf_groups;
ALTER TABLE ncf_import_map RENAME TO xcf_import_map;
ALTER TABLE ncf_installed_plugins RENAME TO xcf_installed_plugins;
ALTER TABLE ncf_installs RENAME TO xcf_installs;
ALTER TABLE ncf_invite_codes RENAME TO xcf_invite_codes;
ALTER TABLE ncf_layouts RENAME TO xcf_layouts;
ALTER TABLE ncf_login_events RENAME TO xcf_login_events;
ALTER TABLE ncf_migration_runs RENAME TO xcf_migration_runs;
ALTER TABLE ncf_moderation_bans RENAME TO xcf_moderation_bans;
ALTER TABLE ncf_moderation_cases RENAME TO xcf_moderation_cases;
ALTER TABLE ncf_moderation_log RENAME TO xcf_moderation_log;
ALTER TABLE ncf_moderation_reports RENAME TO xcf_moderation_reports;
ALTER TABLE ncf_moderation_warnings RENAME TO xcf_moderation_warnings;
ALTER TABLE ncf_nav_items RENAME TO xcf_nav_items;
ALTER TABLE ncf_notification_preferences RENAME TO xcf_notification_preferences;
ALTER TABLE ncf_notifications RENAME TO xcf_notifications;
ALTER TABLE ncf_pages RENAME TO xcf_pages;
ALTER TABLE ncf_password_reset_tokens RENAME TO xcf_password_reset_tokens;
ALTER TABLE ncf_permissions RENAME TO xcf_permissions;
ALTER TABLE ncf_plugin_migrations RENAME TO xcf_plugin_migrations;
ALTER TABLE ncf_profile_comment_likes RENAME TO xcf_profile_comment_likes;
ALTER TABLE ncf_profile_comments RENAME TO xcf_profile_comments;
ALTER TABLE ncf_profile_views RENAME TO xcf_profile_views;
ALTER TABLE ncf_reviewed_security_signals RENAME TO xcf_reviewed_security_signals;
ALTER TABLE ncf_scheduled_task_runs RENAME TO xcf_scheduled_task_runs;
ALTER TABLE ncf_scheduled_tasks RENAME TO xcf_scheduled_tasks;
ALTER TABLE ncf_sessions RENAME TO xcf_sessions;
ALTER TABLE ncf_settings RENAME TO xcf_settings;
ALTER TABLE ncf_style_history RENAME TO xcf_style_history;
ALTER TABLE ncf_tags RENAME TO xcf_tags;
ALTER TABLE ncf_themes RENAME TO xcf_themes;
ALTER TABLE ncf_user_badges RENAME TO xcf_user_badges;
ALTER TABLE ncf_user_blocks RENAME TO xcf_user_blocks;
ALTER TABLE ncf_user_follows RENAME TO xcf_user_follows;
ALTER TABLE ncf_user_groups RENAME TO xcf_user_groups;
ALTER TABLE ncf_user_privacy_settings RENAME TO xcf_user_privacy_settings;
ALTER TABLE ncf_user_profile_field_values RENAME TO xcf_user_profile_field_values;
ALTER TABLE ncf_user_profile_fields RENAME TO xcf_user_profile_fields;
ALTER TABLE ncf_username_history RENAME TO xcf_username_history;
ALTER TABLE ncf_users RENAME TO xcf_users;

-- Constraints
ALTER TABLE xcf_acp_visits RENAME CONSTRAINT ncf_acp_visits_pkey TO xcf_acp_visits_pkey;
ALTER TABLE xcf_activity_log RENAME CONSTRAINT ncf_activity_log_pkey TO xcf_activity_log_pkey;
ALTER TABLE xcf_badges RENAME CONSTRAINT ncf_badges_pkey TO xcf_badges_pkey;
ALTER TABLE xcf_email_templates RENAME CONSTRAINT ncf_email_templates_pkey TO xcf_email_templates_pkey;
ALTER TABLE xcf_entitlements RENAME CONSTRAINT ncf_entitlements_pkey TO xcf_entitlements_pkey;
ALTER TABLE xcf_layouts RENAME CONSTRAINT ncf_layouts_pkey TO xcf_layouts_pkey;
ALTER TABLE xcf_moderation_reports RENAME CONSTRAINT ncf_moderation_reports_target_user_id_fkey TO xcf_moderation_reports_target_user_id_fkey;
ALTER TABLE xcf_nav_items RENAME CONSTRAINT ncf_nav_items_page_id_fkey TO xcf_nav_items_page_id_fkey;
ALTER TABLE xcf_pages RENAME CONSTRAINT ncf_pages_created_by_id_fkey TO xcf_pages_created_by_id_fkey;
ALTER TABLE xcf_pages RENAME CONSTRAINT ncf_pages_pkey TO xcf_pages_pkey;
ALTER TABLE xcf_profile_views RENAME CONSTRAINT ncf_profile_views_pkey TO xcf_profile_views_pkey;
ALTER TABLE xcf_profile_views RENAME CONSTRAINT ncf_profile_views_profile_id_fkey TO xcf_profile_views_profile_id_fkey;
ALTER TABLE xcf_profile_views RENAME CONSTRAINT ncf_profile_views_viewer_id_fkey TO xcf_profile_views_viewer_id_fkey;
ALTER TABLE xcf_scheduled_task_runs RENAME CONSTRAINT ncf_scheduled_task_runs_pkey TO xcf_scheduled_task_runs_pkey;
ALTER TABLE xcf_scheduled_task_runs RENAME CONSTRAINT ncf_scheduled_task_runs_task_id_fkey TO xcf_scheduled_task_runs_task_id_fkey;
ALTER TABLE xcf_scheduled_tasks RENAME CONSTRAINT ncf_scheduled_tasks_pkey TO xcf_scheduled_tasks_pkey;
ALTER TABLE xcf_themes RENAME CONSTRAINT ncf_themes_pkey TO xcf_themes_pkey;
ALTER TABLE xcf_user_badges RENAME CONSTRAINT ncf_user_badges_badge_id_fkey TO xcf_user_badges_badge_id_fkey;
ALTER TABLE xcf_user_badges RENAME CONSTRAINT ncf_user_badges_pkey TO xcf_user_badges_pkey;
ALTER TABLE xcf_user_badges RENAME CONSTRAINT ncf_user_badges_user_id_fkey TO xcf_user_badges_user_id_fkey;

-- Indexes
ALTER INDEX IF EXISTS ncf_activity_log_category_created_at_idx RENAME TO xcf_activity_log_category_created_at_idx;
ALTER INDEX IF EXISTS ncf_activity_log_user_id_idx RENAME TO xcf_activity_log_user_id_idx;
ALTER INDEX IF EXISTS ncf_badges_key_key RENAME TO xcf_badges_key_key;
ALTER INDEX IF EXISTS ncf_entitlements_license_ref_key RENAME TO xcf_entitlements_license_ref_key;
ALTER INDEX IF EXISTS ncf_layouts_scope_template_key_idx RENAME TO xcf_layouts_scope_template_key_idx;
ALTER INDEX IF EXISTS ncf_layouts_template_key_variant_scope_key RENAME TO xcf_layouts_template_key_variant_scope_key;
ALTER INDEX IF EXISTS ncf_nav_items_page_id_idx RENAME TO xcf_nav_items_page_id_idx;
ALTER INDEX IF EXISTS ncf_pages_slug_key RENAME TO xcf_pages_slug_key;
ALTER INDEX IF EXISTS ncf_pages_status_idx RENAME TO xcf_pages_status_idx;
ALTER INDEX IF EXISTS ncf_profile_views_profile_id_viewed_at_idx RENAME TO xcf_profile_views_profile_id_viewed_at_idx;
ALTER INDEX IF EXISTS ncf_scheduled_task_runs_task_id_started_at_idx RENAME TO xcf_scheduled_task_runs_task_id_started_at_idx;
ALTER INDEX IF EXISTS ncf_scheduled_tasks_enabled_idx RENAME TO xcf_scheduled_tasks_enabled_idx;
ALTER INDEX IF EXISTS "ncf_sessions_lastUsedAt_idx" RENAME TO "xcf_sessions_lastUsedAt_idx";
ALTER INDEX IF EXISTS ncf_themes_active_idx RENAME TO xcf_themes_active_idx;
ALTER INDEX IF EXISTS ncf_user_badges_badge_id_idx RENAME TO xcf_user_badges_badge_id_idx;
