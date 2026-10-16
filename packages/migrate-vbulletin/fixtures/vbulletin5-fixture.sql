-- Minimal vBulletin 5/6-shaped fixture (our own DDL of the documented columns the
-- extractor reads, no prefix, deliberately ugly seed data). Everything is a node:
-- the root holds the Forum channel (stock GUID), a Blogs channel and a private
-- message folder; only the Forum's channels and topics may come over.
-- Passwords: dana = "secret5" (blowfish), erik = "secret6" (legacy vB4 hash).

CREATE TABLE setting (varname VARCHAR(100) PRIMARY KEY, value MEDIUMTEXT);
INSERT INTO setting VALUES ('templateversion', '6.0.4');

CREATE TABLE user (
  userid INT PRIMARY KEY, usergroupid SMALLINT NOT NULL, membergroupids VARCHAR(250) NOT NULL DEFAULT '',
  username VARCHAR(100) NOT NULL, email VARCHAR(100) NOT NULL, joindate INT NOT NULL,
  token VARCHAR(255) NOT NULL DEFAULT '', scheme VARCHAR(100) NOT NULL DEFAULT '', secret VARCHAR(100) NOT NULL DEFAULT ''
);
INSERT INTO user VALUES
  (1, 6, '',  'dana', 'dana@vb5.test', 1500000000, '$2y$10$tEPLgFIAV2jueQv3ujgLhejNlCcCGU1NbFc4MyPBPyOowvTOPF0Q6', 'blowfish:10', ''),
  (2, 2, '5', 'erik', 'erik@vb5.test', 1500000100, MD5(CONCAT(MD5('secret6'), 'p@:')), 'legacy', 'p@:'),
  (3, 2, '',  'fay',  'fay@vb5.test',  1500000200, '', '', '');

CREATE TABLE contenttype (contenttypeid INT PRIMARY KEY, class VARCHAR(50) NOT NULL);
INSERT INTO contenttype VALUES (1, 'Channel'), (2, 'Text'), (3, 'Photo'), (4, 'PrivateMessage');

CREATE TABLE node (
  nodeid INT PRIMARY KEY, parentid INT NOT NULL, starter INT NOT NULL DEFAULT 0, contenttypeid INT NOT NULL,
  userid INT NOT NULL DEFAULT 0, title VARCHAR(512), description TEXT, displayorder SMALLINT NOT NULL DEFAULT 0,
  publishdate INT NOT NULL DEFAULT 0, open SMALLINT NOT NULL DEFAULT 1, sticky SMALLINT NOT NULL DEFAULT 0,
  showpublished SMALLINT NOT NULL DEFAULT 1, showapproved SMALLINT NOT NULL DEFAULT 1
);
INSERT INTO node (nodeid, parentid, starter, contenttypeid, userid, title, description, displayorder, publishdate, open, sticky, showpublished, showapproved) VALUES
  (1,  0,  0,  1, 0, 'Home',            NULL, 0, 0, 1, 0, 1, 1),
  (2,  1,  0,  1, 0, 'Forum',           NULL, 1, 0, 1, 0, 1, 1),
  (3,  1,  0,  1, 0, 'Blogs',           NULL, 2, 0, 1, 0, 1, 1),
  (4,  1,  0,  1, 0, 'Private Messages',NULL, 3, 0, 1, 0, 1, 1),
  (10, 2,  0,  1, 0, 'Main Category',   'Top', 1, 0, 1, 0, 1, 1),
  (11, 10, 0,  1, 0, 'General &amp; Chat', 'Talk', 1, 0, 1, 0, 1, 1),
  -- a forum topic with a reply, a comment on the reply, an unpublished reply and a photo
  (20, 11, 20, 2, 1, 'First topic',     NULL, 0, 1510000000, 1, 1, 1, 1),
  (21, 20, 20, 2, 2, NULL,              NULL, 0, 1510000100, 1, 0, 1, 1),
  (22, 21, 20, 2, 3, NULL,              NULL, 0, 1510000200, 1, 0, 1, 1),
  (23, 20, 20, 2, 3, NULL,              NULL, 0, 1510000300, 1, 0, 0, 1),
  (24, 20, 20, 3, 3, 'a photo',         NULL, 0, 1510000400, 1, 0, 1, 1),
  -- a locked topic awaiting nothing, and one awaiting moderation
  (25, 11, 25, 2, 2, 'Locked topic',    NULL, 0, 1510000500, 0, 0, 1, 1),
  (26, 11, 26, 2, 2, 'Pending topic',   NULL, 0, 1510000600, 1, 0, 1, 0),
  -- not forum content: a blog entry and a private message
  (30, 3,  30, 2, 1, 'My blog entry',   NULL, 0, 1510000700, 1, 0, 1, 1),
  (40, 4,  40, 4, 1, 'Secret PM',       NULL, 0, 1510000800, 1, 0, 1, 1);

CREATE TABLE channel (nodeid INT PRIMARY KEY, guid CHAR(150), category SMALLINT NOT NULL DEFAULT 0);
INSERT INTO channel VALUES
  (1, 'vbulletin-4ecbdf567f2773.55528984', 0),
  (2, 'vbulletin-4ecbdf567f2c35.70389590', 1),
  (3, 'vbulletin-4ecbdf567f3341.44450667', 1),
  (4, 'vbulletin-4ecbdf567f36c3.90966558', 1),
  (10, NULL, 1),
  (11, NULL, 0);

CREATE TABLE closure (parent INT NOT NULL, child INT NOT NULL, depth SMALLINT NOT NULL);
INSERT INTO closure VALUES
  (1,1,0),(1,2,1),(1,3,1),(1,4,1),(1,10,2),(1,11,3),
  (2,2,0),(2,10,1),(2,11,2),
  (10,10,0),(10,11,1),
  (11,11,0),(3,3,0),(4,4,0);

CREATE TABLE text (nodeid INT PRIMARY KEY, rawtext MEDIUMTEXT);
INSERT INTO text VALUES
  (20, 'Welcome! [IMG2=JSON]{"data-align":"none","src":"https://x.test/b.jpg"}[/IMG2] [VIDEO=youtube;abc]https://www.youtube.com/watch?v=abc[/VIDEO]'),
  (21, '[QUOTE=dana;n20]Welcome![/QUOTE] thanks [MENTION=1]dana[/MENTION]'),
  (22, 'a comment on the reply'),
  (23, 'unpublished'),
  (25, 'locked body'),
  (26, 'pending body'),
  (30, 'blog body'),
  (40, 'private body');

CREATE TABLE nodeview (nodeid INT PRIMARY KEY, count INT NOT NULL);
INSERT INTO nodeview VALUES (20, 77);

CREATE TABLE reputation (nodeid INT NOT NULL, userid INT NOT NULL, whoadded INT NOT NULL, reputation INT NOT NULL, dateline INT NOT NULL);
INSERT INTO reputation VALUES (20, 1, 2, 1, 1510000900), (21, 2, 1, 1, 1510000950), (30, 1, 3, 1, 1510000960);

CREATE TABLE userlist (userid INT NOT NULL, relationid INT NOT NULL, type VARCHAR(10) NOT NULL, friend VARCHAR(10));
INSERT INTO userlist VALUES (2, 1, 'follow', 'yes'), (3, 1, 'follow', 'pending'), (3, 2, 'ignore', NULL), (1, 3, 'buddy', 'yes');

-- Private messages are nodes under the Private Messages channel (node 4). Node 40
-- (from the forum part above) starts dana → erik; 41 is erik's reply; 42 is a
-- notification, which is not a message and must stay out. Erik deleted his copy of 40.
INSERT INTO node (nodeid, parentid, starter, contenttypeid, userid, title, publishdate) VALUES
  (41, 40, 40, 4, 2, NULL, 1510000850),
  (42, 4, 42, 4, 1, 'You have a new follower', 1510000870);
INSERT INTO text VALUES (41, 'a private reply'), (42, 'notification text');
CREATE TABLE privatemessage (nodeid INT PRIMARY KEY, msgtype VARCHAR(20) NOT NULL);
INSERT INTO privatemessage VALUES (40, 'message'), (41, 'message'), (42, 'notification');
CREATE TABLE sentto (nodeid INT NOT NULL, userid INT NOT NULL, folderid INT NOT NULL DEFAULT 0, deleted SMALLINT NOT NULL DEFAULT 0);
INSERT INTO sentto VALUES (40, 1, 0, 0), (40, 2, 0, 1), (41, 1, 0, 0), (41, 2, 0, 0), (42, 2, 0, 0);

-- Personal info, tags, subscriptions, bans, visitor messages. Expect: dana born
-- 1990-12-01; topic 20 tagged; erik subscribed to 20 (kept) and 26 (pending topic, no
-- subscription); fay banned permanently by dana; a visitor message on dana's wall by erik.
ALTER TABLE user ADD COLUMN birthday CHAR(10) NOT NULL DEFAULT '', ADD COLUMN homepage VARCHAR(100) NOT NULL DEFAULT '';
UPDATE user SET birthday = '12-01-1990' WHERE userid = 1;
ALTER TABLE node ADD COLUMN setfor INT NOT NULL DEFAULT 0;
INSERT INTO node (nodeid, parentid, starter, contenttypeid, userid, title, publishdate, setfor) VALUES (50, 1, 50, 2, 2, NULL, 1510001000, 1);
INSERT INTO text VALUES (50, 'Welcome back [I]dana[/I]');
CREATE TABLE tag (tagid INT PRIMARY KEY, tagtext VARCHAR(100));
INSERT INTO tag VALUES (1, 'announcement');
CREATE TABLE tagnode (tagid INT, nodeid INT);
INSERT INTO tagnode VALUES (1, 20);
CREATE TABLE subscribediscussion (userid INT, discussionid INT, emailupdate SMALLINT DEFAULT 0);
INSERT INTO subscribediscussion VALUES (2, 20, 0), (2, 26, 0);
CREATE TABLE userban (userid INT PRIMARY KEY, adminid INT, bandate INT, liftdate INT, reason VARCHAR(250));
INSERT INTO userban VALUES (3, 1, 1690000000, 0, 'Spam');

-- Avatars stored as files: dana's lives at core/customavatars/avatar1_3.png (under --files).
INSERT INTO setting VALUES ('avatarpath', './core/customavatars');
ALTER TABLE user ADD COLUMN avatarrevision INT NOT NULL DEFAULT 0;
UPDATE user SET avatarrevision = 3 WHERE userid = 1;
CREATE TABLE customavatar (userid INT PRIMARY KEY, filedata MEDIUMBLOB, filename VARCHAR(100), extension VARCHAR(10));
INSERT INTO customavatar VALUES (1, '', 'avatar.png', 'png');

-- Infractions are nodes: dana gave erik one that never expires; an expired one stays out.
INSERT INTO node (nodeid, parentid, starter, contenttypeid, userid, title, publishdate) VALUES (60, 1, 60, 2, 1, 'Infraction', 1510002000), (61, 1, 61, 2, 1, 'Infraction', 1500000000);
CREATE TABLE infraction (nodeid INT PRIMARY KEY, infracteduserid INT, infractednodeid INT, points INT, action SMALLINT, expires INT UNSIGNED, customreason VARCHAR(255), note VARCHAR(255));
INSERT INTO infraction VALUES (60, 2, 21, 1, 0, 0, 'Be nice', ''), (61, 2, 21, 1, 0, 1500100000, 'old', '');

-- Channel addresses have no id in them; vBulletin keeps them in its route table.
CREATE TABLE routenew (routeid INT PRIMARY KEY, prefix VARCHAR(200), class VARCHAR(100), contentid INT);
INSERT INTO routenew VALUES (1, 'forum', 'vB5_Route_Channel', 2), (2, 'forum/main-category', 'vB5_Route_Channel', 10),
  (3, 'forum/main-category/general-chat', 'vB5_Route_Channel', 11), (4, 'forum/main-category/general-chat/20-first-topic', 'vB5_Route_Conversation', 20);

-- Member groups: vB5's own system groups (systemgroupid > 0) stay out, "Helpers" (20) comes over.
CREATE TABLE usergroup (usergroupid SMALLINT PRIMARY KEY, title CHAR(100) NOT NULL, systemgroupid SMALLINT NOT NULL DEFAULT 0);
INSERT INTO usergroup VALUES (2, 'Registered Users', 2), (9, 'Channel Owner', 9), (20, 'Helpers', 0);
UPDATE user SET membergroupids = '9,20' WHERE userid = 3;

-- Thread prefixes on channels: set "status" in channel 11 holds "done"; topic 20 is done.
CREATE TABLE prefix (prefixid VARCHAR(25) PRIMARY KEY, prefixsetid VARCHAR(25), displayorder INT NOT NULL DEFAULT 0);
INSERT INTO prefix VALUES ('done', 'status', 1);
CREATE TABLE phrase (phraseid INT PRIMARY KEY, languageid INT, varname VARCHAR(250), text MEDIUMTEXT);
INSERT INTO phrase VALUES (1, -1, 'prefix_done_title_plain', 'Done'), (2, -1, 'prefix_done_title_rich', '<b class="prefix-blue">Done</b>');
CREATE TABLE channelprefixset (nodeid INT, prefixsetid VARCHAR(25));
INSERT INTO channelprefixset VALUES (11, 'status');
ALTER TABLE node ADD COLUMN prefixid VARCHAR(25) NOT NULL DEFAULT '';
UPDATE node SET prefixid = 'done' WHERE nodeid = 20;

ALTER TABLE user ADD COLUMN lastvisit INT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN lastactivity INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE user SET lastactivity = 1650000000 WHERE userid = 2;
