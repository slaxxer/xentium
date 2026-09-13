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
