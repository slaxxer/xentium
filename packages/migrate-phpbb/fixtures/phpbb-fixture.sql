-- Minimal phpBB 3.3-shaped fixture for adapter testing (§34 testing strategy:
-- no phpBB installation — just the documented table structure the extractor
-- reads, recreated as our own DDL, plus deliberately ugly seed data).

CREATE TABLE phpbb_config (
  config_name  VARCHAR(255) PRIMARY KEY,
  config_value VARCHAR(255) NOT NULL
);

CREATE TABLE phpbb_users (
  user_id       INT PRIMARY KEY,
  username      VARCHAR(255) NOT NULL,
  user_email    VARCHAR(100) NOT NULL,
  user_password VARCHAR(255) NOT NULL,
  user_regdate  INT NOT NULL DEFAULT 0,
  user_type     TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE phpbb_groups (
  group_id   INT PRIMARY KEY,
  group_name VARCHAR(255) NOT NULL
);

CREATE TABLE phpbb_user_group (
  user_id      INT NOT NULL,
  group_id     INT NOT NULL,
  user_pending TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE phpbb_forums (
  forum_id   INT PRIMARY KEY,
  parent_id  INT NOT NULL DEFAULT 0,
  forum_name VARCHAR(255) NOT NULL,
  forum_desc TEXT,
  forum_type TINYINT NOT NULL DEFAULT 1,
  left_id    INT NOT NULL DEFAULT 0
);

CREATE TABLE phpbb_topics (
  topic_id         INT PRIMARY KEY,
  forum_id         INT NOT NULL,
  topic_title      VARCHAR(255) NOT NULL,
  topic_poster     INT NOT NULL,
  topic_time       INT NOT NULL,
  topic_status     TINYINT NOT NULL DEFAULT 0,
  topic_type       TINYINT NOT NULL DEFAULT 0,
  topic_views      INT NOT NULL DEFAULT 0,
  topic_visibility TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE phpbb_posts (
  post_id         INT PRIMARY KEY,
  topic_id        INT NOT NULL,
  poster_id       INT NOT NULL,
  post_time       INT NOT NULL,
  post_edit_time  INT NOT NULL DEFAULT 0,
  post_text       MEDIUMTEXT NOT NULL,
  bbcode_uid      VARCHAR(8) NOT NULL DEFAULT '',
  post_visibility TINYINT NOT NULL DEFAULT 1
);

INSERT INTO phpbb_config VALUES ('version', '3.3.11');

-- founder (bcrypt), member w/ moderator group (bcrypt), member (phpass),
-- ancient md5 hash (unusable), a bot (skipped), a broken row (no email)
INSERT INTO phpbb_users VALUES
  (1, 'root',    'root@board.test',  '$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 1500000000, 3),
  (2, 'alice',   'alice@board.test', '$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 1550000000, 0),
  (3, 'bob',     'bob@board.test',   '$H$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0',                            1600000000, 0),
  (4, 'olduser', 'old@board.test',   '5f4dcc3b5aa765d61d8327deb882cf99',                              1400000000, 0),
  (5, 'CrawlerBot', 'bot@board.test', '',                                                             1400000000, 2),
  (6, 'ghost',   '',                 '$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 1400000000, 0);

INSERT INTO phpbb_groups VALUES (5, 'ADMINISTRATORS'), (4, 'GLOBAL_MODERATORS'), (2, 'REGISTERED');
INSERT INTO phpbb_user_group VALUES (1, 5, 0), (2, 4, 0), (3, 2, 0);

-- category > 2 forums (one with a subforum) + a link forum (skipped)
INSERT INTO phpbb_forums VALUES
  (1, 0, 'Community',          'Main category',          0, 1),
  (2, 1, 'General Discussion', 'Talk about anything',    1, 2),
  (3, 1, 'Support',            'Get help',               1, 4),
  (4, 1, 'Our Discord',        'External link',          2, 8),
  (5, 3, 'Advanced Support',   'Deep dives',             1, 5);

INSERT INTO phpbb_topics VALUES
  (10, 2, 'Welcome to the board 🎉', 2, 1700000000, 0, 1, 1234, 1),  -- sticky, by alice
  (11, 3, 'Help, everything is broken', 3, 1700100000, 1, 0, 56, 1), -- locked, by bob
  (12, 2, 'Spam topic', 4, 1700200000, 0, 0, 1, 0);                  -- unapproved → skipped

INSERT INTO phpbb_posts VALUES
  -- legacy bbcode_uid format (3.0/3.1-era post that survived upgrades)
  (100, 10, 2, 1700000000, 0,
   'Welcome! This is [b:1a2b3c4d]bold[/b:1a2b3c4d] and here is a list:\n[list:1a2b3c4d][*:1a2b3c4d]first[/*:m:1a2b3c4d][*:1a2b3c4d]second[/*:m:1a2b3c4d][/list:u:1a2b3c4d] enjoy <!-- s:) --><img src="{SMILIES_PATH}/icon_smile.gif" alt=":)" title="Smile" /><!-- s:) -->',
   '1a2b3c4d', 1),
  -- s9e rich format (3.2+)
  (101, 10, 3, 1700050000, 1700060000,
   '<r>Thanks <B><s>[b]</s>alice<e>[/b]</e></B>! See <URL url="https://xentium.org"><s>[url=https://xentium.org]</s>this<e>[/url]</e></URL> <E>:lol:</E><QUOTE author="alice"><s>[quote=alice]</s>Welcome!<e>[/quote]</e></QUOTE></r>',
   '', 1),
  -- s9e plain format
  (102, 10, 1, 1700070000, 0, '<t>Founder checking in.<br/>Carry on.</t>', '', 1),
  -- first post of the locked topic
  (103, 11, 3, 1700100000, 0, '<t>It broke. 1 &lt; 2 but still.</t>', '', 1),
  -- unapproved post → skipped
  (104, 11, 4, 1700110000, 0, '<t>me too (pending approval)</t>', '', 0),
  -- post in the unapproved topic → fails at load (thread not imported), reported
  (105, 12, 4, 1700200000, 0, '<t>spam spam</t>', '', 1);

CREATE TABLE phpbb_zebra (
  user_id  INT NOT NULL,
  zebra_id INT NOT NULL,
  friend   TINYINT NOT NULL DEFAULT 0,
  foe      TINYINT NOT NULL DEFAULT 0
);
-- bob foes olduser (→ block); alice friends bob (NOT mapped)
INSERT INTO phpbb_zebra VALUES (3, 4, 0, 1), (2, 3, 1, 0);

-- Private messages: alice → bob, bob replies (same chain via root_level), and a group
-- message from root to alice and bob that bob deleted his copy of.
CREATE TABLE phpbb_privmsgs (
  msg_id INT PRIMARY KEY, root_level INT NOT NULL DEFAULT 0, author_id INT NOT NULL, message_time INT NOT NULL,
  message_subject VARCHAR(255) NOT NULL, message_text MEDIUMTEXT NOT NULL, bbcode_uid VARCHAR(8) NOT NULL DEFAULT ''
);
INSERT INTO phpbb_privmsgs VALUES
  (1, 0, 2, 1700000000, 'Q&amp;A night', 'Coming <s>tonight</s>?', ''),
  (2, 1, 3, 1700000100, 'Re: Q&amp;A night', 'Sure!', ''),
  (3, 0, 1, 1700000200, 'Team note', 'Hi both', '');
CREATE TABLE phpbb_privmsgs_to (msg_id INT NOT NULL, user_id INT NOT NULL, author_id INT NOT NULL, pm_deleted TINYINT NOT NULL DEFAULT 0);
INSERT INTO phpbb_privmsgs_to VALUES (1, 3, 2, 0), (2, 2, 3, 0), (3, 2, 1, 0), (3, 3, 1, 1);

-- Personal info, topic watches and bans. Expect: alice born 1990-03-05 with a website,
-- bob's "0-0-0" birthday ignored; alice watches topic 10 (kept) and 12 (skipped topic,
-- so no subscription); olduser banned permanently, an IP-only ban and an expired ban ignored.
ALTER TABLE phpbb_users ADD COLUMN user_birthday VARCHAR(10) NOT NULL DEFAULT '';
UPDATE phpbb_users SET user_birthday = ' 5- 3-1990' WHERE user_id = 2;
UPDATE phpbb_users SET user_birthday = ' 0- 0-   0' WHERE user_id = 3;
CREATE TABLE phpbb_profile_fields_data (user_id INT PRIMARY KEY, pf_phpbb_website VARCHAR(255) NOT NULL DEFAULT '');
INSERT INTO phpbb_profile_fields_data VALUES (2, 'https://alice.example'), (3, 'javascript:alert(1)');
CREATE TABLE phpbb_topics_watch (topic_id INT NOT NULL, user_id INT NOT NULL, notify_status TINYINT NOT NULL DEFAULT 0);
INSERT INTO phpbb_topics_watch VALUES (10, 2, 0), (12, 2, 0), (11, 3, 0);
CREATE TABLE phpbb_banlist (ban_id INT PRIMARY KEY, ban_userid INT NOT NULL DEFAULT 0, ban_ip VARCHAR(40) NOT NULL DEFAULT '', ban_start INT NOT NULL, ban_end INT NOT NULL DEFAULT 0, ban_exclude TINYINT NOT NULL DEFAULT 0, ban_reason VARCHAR(255) NOT NULL DEFAULT '', ban_give_reason VARCHAR(255) NOT NULL DEFAULT '');
INSERT INTO phpbb_banlist VALUES (1, 4, '', 1690000000, 0, 0, 'spam', 'Spamming &amp; abuse'), (2, 0, '10.0.0.1', 1690000000, 0, 0, '', ''), (3, 3, '', 1600000000, 1600100000, 0, 'old', 'old');

-- Avatars (files under --files): alice has an uploaded avatar; bob's "avatar" is a
-- text file with a .png name and must be refused; root uses a remote avatar (stays out).
INSERT INTO phpbb_config VALUES ('avatar_path', 'images/avatars/upload'), ('avatar_salt', 'abc123salt');
ALTER TABLE phpbb_users ADD COLUMN user_avatar VARCHAR(255) NOT NULL DEFAULT '', ADD COLUMN user_avatar_type VARCHAR(255) NOT NULL DEFAULT '';
UPDATE phpbb_users SET user_avatar = '2_1700000000.png', user_avatar_type = 'avatar.driver.upload' WHERE user_id = 2;
UPDATE phpbb_users SET user_avatar = '3_1700000000.png', user_avatar_type = 'avatar.driver.upload' WHERE user_id = 3;
UPDATE phpbb_users SET user_avatar = 'https://x.test/a.png', user_avatar_type = 'avatar.driver.remote' WHERE user_id = 1;

-- Warnings expire after 3650 days on this board: bob's recent one stays, the 2001 one is long gone.
INSERT INTO phpbb_config VALUES ('warnings_expire_days', '3650');
CREATE TABLE phpbb_log (log_id INT PRIMARY KEY, user_id INT, log_operation VARCHAR(255), log_data MEDIUMTEXT);
INSERT INTO phpbb_log VALUES (1, 1, 'LOG_USER_WARNING_BODY', 'a:1:{i:0;s:21:"Rude &amp; off-topic!";}'), (2, 1, 'LOG_USER_WARNING_BODY', 'a:1:{i:0;s:3:"old";}');
CREATE TABLE phpbb_warnings (warning_id INT PRIMARY KEY, user_id INT, post_id INT, log_id INT, warning_time INT);
INSERT INTO phpbb_warnings VALUES (1, 3, 0, 1, UNIX_TIMESTAMP() - 86400), (2, 3, 0, 2, 1000000000);

-- Member groups: phpBB's own are type 3 (special); "Donors &amp; friends" is a custom one.
-- bob (3) is in it; alice's request (2) is still pending, so she isn't.
ALTER TABLE phpbb_groups ADD COLUMN group_type TINYINT NOT NULL DEFAULT 3;
INSERT INTO phpbb_groups VALUES (7, 'Donors &amp; friends', 0);
INSERT INTO phpbb_user_group VALUES (3, 7, 0), (2, 7, 1);

-- Last visits: user 2 was last here in 2019, user 3 never logged in (0).
ALTER TABLE phpbb_users ADD COLUMN user_lastvisit INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE phpbb_users SET user_lastvisit = 1560000000 WHERE user_id = 2;
