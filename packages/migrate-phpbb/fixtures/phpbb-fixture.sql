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
   '<r>Thanks <B><s>[b]</s>alice<e>[/b]</e></B>! See <URL url="https://nodevo.io"><s>[url=https://nodevo.io]</s>this<e>[/url]</e></URL> <E>:lol:</E><QUOTE author="alice"><s>[quote=alice]</s>Welcome!<e>[/quote]</e></QUOTE></r>',
   '', 1),
  -- s9e plain format
  (102, 10, 1, 1700070000, 0, '<t>Founder checking in.<br/>Carry on.</t>', '', 1),
  -- first post of the locked topic
  (103, 11, 3, 1700100000, 0, '<t>It broke. 1 &lt; 2 but still.</t>', '', 1),
  -- unapproved post → skipped
  (104, 11, 4, 1700110000, 0, '<t>me too (pending approval)</t>', '', 0),
  -- post in the unapproved topic → fails at load (thread not imported), reported
  (105, 12, 4, 1700200000, 0, '<t>spam spam</t>', '', 1);
