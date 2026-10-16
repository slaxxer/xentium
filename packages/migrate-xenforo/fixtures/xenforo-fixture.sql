-- Minimal XenForo 2.x-shaped fixture (§34 testing strategy: own DDL of the
-- documented structure the extractor reads + adversarial seed data).

CREATE TABLE xf_option (
  option_id    VARCHAR(50) PRIMARY KEY,
  option_value TEXT
);

CREATE TABLE xf_user (
  user_id       INT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL,
  email         VARCHAR(120) NOT NULL,
  register_date INT NOT NULL DEFAULT 0,
  user_state    VARCHAR(25) NOT NULL DEFAULT 'valid',
  is_admin      TINYINT NOT NULL DEFAULT 0,
  is_moderator  TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE xf_user_authenticate (
  user_id      INT PRIMARY KEY,
  scheme_class VARCHAR(75) NOT NULL,
  data         MEDIUMBLOB
);

CREATE TABLE xf_node (
  node_id        INT PRIMARY KEY,
  parent_node_id INT NOT NULL DEFAULT 0,
  title          VARCHAR(50) NOT NULL,
  description    TEXT,
  node_type_id   VARCHAR(25) NOT NULL,
  display_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE xf_thread (
  thread_id        INT PRIMARY KEY,
  node_id          INT NOT NULL,
  title            VARCHAR(150) NOT NULL,
  user_id          INT NOT NULL,
  post_date        INT NOT NULL,
  discussion_state VARCHAR(15) NOT NULL DEFAULT 'visible',
  discussion_open  TINYINT NOT NULL DEFAULT 1,
  sticky           TINYINT NOT NULL DEFAULT 0,
  view_count       INT NOT NULL DEFAULT 0
);

CREATE TABLE xf_post (
  post_id        INT PRIMARY KEY,
  thread_id      INT NOT NULL,
  user_id        INT NOT NULL,
  post_date      INT NOT NULL,
  last_edit_date INT NOT NULL DEFAULT 0,
  message        MEDIUMTEXT NOT NULL,
  message_state  VARCHAR(15) NOT NULL DEFAULT 'visible'
);

INSERT INTO xf_option VALUES ('currentVersionId', '2021370'); -- 2.2.13

INSERT INTO xf_user VALUES
  (1, 'root',  'root@board.test',  1500000000, 'valid', 1, 1),
  (2, 'alice', 'alice@board.test', 1550000000, 'valid', 0, 1),
  (3, 'bob',   'bob@board.test',   1600000000, 'valid', 0, 0),
  (4, 'legacy','legacy@board.test',1400000000, 'valid', 0, 0),
  (5, 'ghost', '',                 1400000000, 'valid', 0, 0);

INSERT INTO xf_user_authenticate VALUES
  (1, 'XF:Core12', 'a:1:{s:4:"hash";s:60:"$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";}'),
  (2, 'XF:Core12', 'a:1:{s:4:"hash";s:60:"$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";}'),
  (3, 'XF:Core12', 'a:1:{s:4:"hash";s:60:"$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";}'),
  (4, 'XF:Legacy_phpBB3', 'a:2:{s:4:"hash";s:32:"5f4dcc3b5aa765d61d8327deb882cf99";s:4:"salt";s:3:"abc";}');

INSERT INTO xf_node VALUES
  (1, 0, 'Main Category', 'The category',  'Category',  1),
  (2, 1, 'General',       'General talk',  'Forum',     2),
  (3, 1, 'Help Desk',     'Get support',   'Forum',     3),
  (4, 3, 'Advanced',      'Deep dives',    'Forum',     4),
  (5, 0, 'Our Discord',   'External',      'LinkForum', 5),
  (6, 0, 'Rules Page',    'Static page',   'Page',      6);

INSERT INTO xf_thread VALUES
  (10, 2, 'Welcome aboard 🚀', 2, 1700000000, 'visible', 1, 1, 999),
  (11, 3, 'Locked support thread', 3, 1700100000, 'visible', 0, 0, 42),
  (12, 2, 'Moderated spam', 4, 1700200000, 'moderated', 1, 0, 1);

INSERT INTO xf_post VALUES
  (100, 10, 2, 1700000000, 0,
   'Welcome! [B]Bold[/B] start, a [URL=''https://xentium.org'']link[/URL] and a quote:\n[QUOTE="bob, post: 99, member: 3"]quoted text[/QUOTE]\n[LIST]\n[*]first\n[*]second\n[/LIST]',
   'visible'),
  (101, 10, 3, 1700050000, 1700060000,
   'Thanks [USER=2]@alice[/USER]! Check [MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] and [ATTACH]55[/ATTACH] 1 &lt; 2',
   'visible'),
  (102, 11, 3, 1700100000, 0, 'My issue [CODE]rm -rf /[/CODE] please help', 'visible'),
  (103, 11, 1, 1700110000, 0, 'Deleted reply', 'deleted'),
  (104, 12, 4, 1700200000, 0, 'spam in moderated thread', 'visible');

CREATE TABLE xf_reaction_content (
  reaction_content_id INT PRIMARY KEY,
  content_type     VARCHAR(25) NOT NULL,
  content_id       INT NOT NULL,
  reaction_id      INT NOT NULL DEFAULT 1,
  reaction_user_id INT NOT NULL,
  reaction_date    INT NOT NULL
);
-- bob likes post 100, root "loves" post 100 (collapses to like), alice likes post 102;
-- a reaction on a non-post is ignored
INSERT INTO xf_reaction_content VALUES
  (1, 'post', 100, 1, 3, 1700001000),
  (2, 'post', 100, 2, 1, 1700002000),
  (3, 'post', 102, 1, 2, 1700101000),
  (4, 'profile_post', 7, 1, 2, 1700101000);

CREATE TABLE xf_user_follow (
  user_id        INT NOT NULL,
  follow_user_id INT NOT NULL,
  follow_date    INT NOT NULL
);
-- bob follows alice; alice follows root; legacy follows bob — but bob ignores
-- legacy below, so that follow must be suppressed (§36)
INSERT INTO xf_user_follow VALUES (3, 2, 1700000100), (2, 1, 1700000200), (4, 3, 1700000300);

CREATE TABLE xf_user_ignored (
  user_id         INT NOT NULL,
  ignored_user_id INT NOT NULL
);
INSERT INTO xf_user_ignored VALUES (3, 4);

-- Conversations: alice ↔ bob (bob removed it from his list), and a group one by root.
CREATE TABLE xf_conversation_master (conversation_id INT PRIMARY KEY, title VARCHAR(150), user_id INT, start_date INT);
INSERT INTO xf_conversation_master VALUES (1, 'Lunch?', 2, 1700000000), (2, 'Team', 1, 1700000100);
CREATE TABLE xf_conversation_recipient (conversation_id INT, user_id INT, recipient_state VARCHAR(20));
INSERT INTO xf_conversation_recipient VALUES (1, 2, 'active'), (1, 3, 'deleted'), (2, 1, 'active'), (2, 2, 'active'), (2, 3, 'active');
CREATE TABLE xf_conversation_message (message_id INT PRIMARY KEY, conversation_id INT, user_id INT, message_date INT, message MEDIUMTEXT);
INSERT INTO xf_conversation_message VALUES (10, 1, 2, 1700000000, 'Lunch [B]today[/B]?'), (11, 1, 3, 1700000050, 'Yes'), (12, 2, 1, 1700000100, 'Hi team');

-- Personal info, tags, watches, bans, profile posts. Expect: alice born 1992-07-14,
-- thread 10 tagged "welcome, Intro", watches only on kept threads, legacy banned until
-- 2099 by root, a wall post on alice's profile by bob with a reply by root.
CREATE TABLE xf_user_profile (user_id INT PRIMARY KEY, dob_day TINYINT, dob_month TINYINT, dob_year SMALLINT, website TEXT);
INSERT INTO xf_user_profile VALUES (2, 14, 7, 1992, 'https://alice.example'), (3, 1, 1, 0, '');
CREATE TABLE xf_tag (tag_id INT PRIMARY KEY, tag VARCHAR(100));
INSERT INTO xf_tag VALUES (1, 'welcome'), (2, 'Intro'), (3, 'spam');
CREATE TABLE xf_tag_content (content_type VARCHAR(25), content_id INT, tag_id INT, visible TINYINT DEFAULT 1);
INSERT INTO xf_tag_content VALUES ('thread', 10, 1, 1), ('thread', 10, 2, 1), ('thread', 12, 3, 1);
CREATE TABLE xf_thread_watch (user_id INT, thread_id INT, email_subscribe TINYINT DEFAULT 0);
INSERT INTO xf_thread_watch VALUES (3, 10, 0), (2, 12, 0);
CREATE TABLE xf_user_ban (user_id INT PRIMARY KEY, ban_user_id INT, ban_date INT UNSIGNED, end_date INT UNSIGNED, user_reason VARCHAR(255));
INSERT INTO xf_user_ban VALUES (4, 1, 1690000000, 4070908800, 'Spam'), (3, 1, 1600000000, 1600100000, 'expired');
CREATE TABLE xf_profile_post (profile_post_id INT PRIMARY KEY, profile_user_id INT, user_id INT, post_date INT, message TEXT, message_state VARCHAR(20));
INSERT INTO xf_profile_post VALUES (1, 2, 3, 1700300000, 'Happy [B]birthday[/B]!', 'visible'), (2, 2, 4, 1700300100, 'spam', 'moderated');
CREATE TABLE xf_profile_post_comment (profile_post_comment_id INT PRIMARY KEY, profile_post_id INT, user_id INT, comment_date INT, message TEXT, message_state VARCHAR(20));
INSERT INTO xf_profile_post_comment VALUES (1, 1, 1, 1700300200, 'Thanks from the team', 'visible');

-- Avatars (files under --files): alice has one (data/avatars/o/0/2.jpg, actually a PNG).
ALTER TABLE xf_user ADD COLUMN avatar_date INT NOT NULL DEFAULT 0;
UPDATE xf_user SET avatar_date = 1700000000 WHERE user_id = 2;

-- Warnings: bob has one active until 2099 and one already expired (stays out).
CREATE TABLE xf_warning (warning_id INT PRIMARY KEY, content_type VARCHAR(25), content_id INT, user_id INT, warning_date INT UNSIGNED, warning_user_id INT, title VARCHAR(255), points SMALLINT, expiry_date INT UNSIGNED, is_expired TINYINT);
INSERT INTO xf_warning VALUES (1, 'post', 1, 3, 1700000000, 1, 'Off-topic posting', 1, 4070908800, 0), (2, 'post', 1, 3, 1600000000, 1, 'Old one', 1, 1600100000, 1);

-- Member groups: the stock four plus "VIP" (5) and "Beta testers" (6). bob is a VIP by
-- his primary group and a beta tester as a secondary one; alice is a beta tester.
CREATE TABLE xf_user_group (user_group_id INT PRIMARY KEY, title VARCHAR(50) NOT NULL);
INSERT INTO xf_user_group VALUES (1, 'Unregistered / Unconfirmed'), (2, 'Registered'), (3, 'Administrative'), (4, 'Moderating'), (5, 'VIP'), (6, 'Beta testers');
ALTER TABLE xf_user ADD COLUMN user_group_id INT NOT NULL DEFAULT 2, ADD COLUMN secondary_group_ids VARBINARY(255) NOT NULL DEFAULT '';
UPDATE xf_user SET user_group_id = 5, secondary_group_ids = '6' WHERE user_id = 3;
UPDATE xf_user SET secondary_group_ids = '3,4,6' WHERE user_id = 2;
-- A name the target already uses ("Supporter"): reused only if that group grants nothing.
INSERT INTO xf_user_group VALUES (7, 'Supporter');
UPDATE xf_user SET secondary_group_ids = '6,7' WHERE user_id = 3;

-- Thread prefixes: "Announcement" (red, forum 2) on thread 10, "Solved" (green, forum 3)
-- on thread 11, and "Old" offered only in a forum that doesn't exist here (stays out).
CREATE TABLE xf_thread_prefix (prefix_id INT PRIMARY KEY, prefix_group_id INT NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 1, css_class VARCHAR(50) NOT NULL DEFAULT '');
INSERT INTO xf_thread_prefix VALUES (1, 0, 1, 'label label--red'), (2, 0, 2, 'label label--green'), (3, 0, 3, 'label label--primary');
CREATE TABLE xf_phrase (phrase_id INT PRIMARY KEY, language_id INT NOT NULL, title VARCHAR(100) NOT NULL, phrase_text MEDIUMTEXT NOT NULL);
INSERT INTO xf_phrase VALUES (1, 0, 'thread_prefix.1', 'Announcement'), (2, 0, 'thread_prefix.2', 'Solved'), (3, 0, 'thread_prefix.3', 'Old'), (4, 1, 'thread_prefix.1', 'Ankündigung');
CREATE TABLE xf_forum_prefix (node_id INT NOT NULL, prefix_id INT NOT NULL);
INSERT INTO xf_forum_prefix VALUES (2, 1), (3, 2), (99, 3);
ALTER TABLE xf_thread ADD COLUMN prefix_id INT NOT NULL DEFAULT 0;
UPDATE xf_thread SET prefix_id = 1 WHERE thread_id = 10;
UPDATE xf_thread SET prefix_id = 2 WHERE thread_id = 11;

-- Last activity: alice was here in 2024; root (merged admin) far earlier, so it won't move.
ALTER TABLE xf_user ADD COLUMN last_activity INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE xf_user SET last_activity = 1717000000 WHERE user_id = 2;
UPDATE xf_user SET last_activity = 1500000001 WHERE user_id = 1;
