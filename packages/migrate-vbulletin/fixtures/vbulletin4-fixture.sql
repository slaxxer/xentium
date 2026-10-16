-- Minimal vBulletin 3/4-shaped fixture (no vBulletin install: our own DDL of the
-- documented columns the extractor reads, with the prefix "vb_" and deliberately
-- ugly seed data). Passwords: alice = "secret1", bob = "secret2".

CREATE TABLE vb_setting (varname VARCHAR(100) PRIMARY KEY, value MEDIUMTEXT);
INSERT INTO vb_setting VALUES ('templateversion', '4.2.5');

CREATE TABLE vb_user (
  userid INT PRIMARY KEY, usergroupid SMALLINT NOT NULL, membergroupids VARCHAR(250) NOT NULL DEFAULT '',
  username VARCHAR(100) NOT NULL, password CHAR(32) NOT NULL, salt CHAR(30) NOT NULL,
  email VARCHAR(100) NOT NULL, joindate INT NOT NULL
);
INSERT INTO vb_user VALUES
  (1, 6, '',  'alice',          MD5(CONCAT(MD5('secret1'), 'a~:')), 'a~:', 'alice@vb4.test', 1300000000),
  (2, 2, '7', 'Bob &amp; Co',   MD5(CONCAT(MD5('secret2'), 'xyz')), 'xyz', 'bob@vb4.test',   1300000100),
  (3, 2, '',  'carol',          '', '', 'carol@vb4.test', 1300000200),
  (4, 2, '',  'noemail',        '', '', '', 1300000300);

CREATE TABLE vb_forum (
  forumid SMALLINT PRIMARY KEY, title VARCHAR(100) NOT NULL, description TEXT, options INT NOT NULL,
  displayorder SMALLINT NOT NULL, parentid SMALLINT NOT NULL, link VARCHAR(200) NOT NULL DEFAULT ''
);
INSERT INTO vb_forum VALUES
  (1, 'Main &amp; More', 'Top category', 1,     1, -1, ''),
  (2, 'General',         'Talk',         1 | 4, 1,  1, ''),
  (3, 'Our website',     '',             1 | 4, 2,  1, 'https://example.test');

CREATE TABLE vb_thread (
  threadid INT PRIMARY KEY, title VARCHAR(250) NOT NULL, forumid SMALLINT NOT NULL, postuserid INT NOT NULL,
  dateline INT NOT NULL, open SMALLINT NOT NULL, sticky SMALLINT NOT NULL, views INT NOT NULL, visible SMALLINT NOT NULL
);
INSERT INTO vb_thread VALUES
  (10, 'Welcome &lt;everyone&gt;', 2, 1, 1310000000, 1,  1, 42, 1),
  (11, 'Closed one',               2, 2, 1310000100, 0,  0, 5,  1),
  (12, 'Moved here',               2, 2, 1310000200, 10, 0, 0,  1),
  (13, 'Awaiting approval',        2, 2, 1310000300, 1,  0, 0,  0),
  (14, 'From a guest',             2, 0, 1310000400, 1,  0, 0,  1);

CREATE TABLE vb_post (
  postid INT PRIMARY KEY, threadid INT NOT NULL, userid INT NOT NULL, dateline INT NOT NULL,
  pagetext MEDIUMTEXT, visible SMALLINT NOT NULL
);
INSERT INTO vb_post VALUES
  (100, 10, 1, 1310000000, 'Hello [B]world[/B] & <script>alert(1)</script> [URL=javascript:alert(1)]bad[/URL] [URL=https://ok.test]good[/URL]', 1),
  (101, 10, 2, 1310000050, '[QUOTE=alice;100]Hello[/QUOTE]\nHi! [ATTACH=CONFIG]5[/ATTACH] &#8364;', 1),
  (102, 10, 0, 1310000060, 'guest reply', 1),
  (103, 10, 3, 1310000070, 'deleted reply', 2),
  (104, 11, 2, 1310000100, '[CODE]if (a < b) [B]x[/B][/CODE]', 1),
  (105, 12, 2, 1310000200, 'moved', 1),
  (106, 14, 0, 1310000400, 'guest thread', 1);

CREATE TABLE vb_editlog (postid INT NOT NULL, dateline INT NOT NULL);
INSERT INTO vb_editlog VALUES (101, 1310000999);

CREATE TABLE vb_userlist (userid INT NOT NULL, relationid INT NOT NULL, type ENUM('buddy','ignore') NOT NULL);
INSERT INTO vb_userlist VALUES (1, 2, 'buddy'), (3, 2, 'ignore');

-- Private messages: alice → Bob, Bob replies (his reply's copy for alice points at
-- Bob's copy of alice's message), and a separate alice → carol message.
CREATE TABLE vb_pmtext (pmtextid INT PRIMARY KEY, fromuserid INT NOT NULL, title VARCHAR(250), message MEDIUMTEXT, dateline INT NOT NULL);
INSERT INTO vb_pmtext VALUES (1, 1, 'Hello &amp; welcome', 'Hi [B]Bob[/B]', 1700000000), (2, 2, 'Re: Hello &amp; welcome', 'Thanks!', 1700000100), (3, 1, 'Other', 'Hi carol', 1700000200);
CREATE TABLE vb_pm (pmid INT PRIMARY KEY, pmtextid INT NOT NULL, userid INT NOT NULL, folderid INT NOT NULL DEFAULT 0, parentpmid INT NOT NULL DEFAULT 0);
INSERT INTO vb_pm VALUES (10, 1, 2, 0, 0), (11, 1, 1, -1, 0), (12, 2, 1, 0, 10), (13, 3, 3, 0, 0);

-- Personal info, tags, subscriptions, bans, visitor messages. Expect: alice born
-- 1985-04-23 with a homepage; thread 10 tagged; Bob subscribed to 10 (kept) and 13
-- (skipped thread, no subscription); carol banned until 2099 by alice; a visitor
-- message on alice's profile by Bob.
ALTER TABLE vb_user ADD COLUMN birthday CHAR(10) NOT NULL DEFAULT '', ADD COLUMN homepage VARCHAR(100) NOT NULL DEFAULT '';
UPDATE vb_user SET birthday = '04-23-1985', homepage = 'https://alice.example' WHERE userid = 1;
UPDATE vb_user SET homepage = 'http://' WHERE userid = 2;
CREATE TABLE vb_contenttype (contenttypeid INT PRIMARY KEY, class VARCHAR(50));
INSERT INTO vb_contenttype VALUES (2, 'Thread');
CREATE TABLE vb_tag (tagid INT PRIMARY KEY, tagtext VARCHAR(100));
INSERT INTO vb_tag VALUES (1, 'welcome'), (2, 'news &amp; info');
CREATE TABLE vb_tagcontent (tagid INT, contenttypeid INT, contentid INT);
INSERT INTO vb_tagcontent VALUES (1, 2, 10), (2, 2, 10);
CREATE TABLE vb_subscribethread (userid INT, threadid INT, emailupdate SMALLINT DEFAULT 0);
INSERT INTO vb_subscribethread VALUES (2, 10, 0), (2, 13, 0);
CREATE TABLE vb_userban (userid INT PRIMARY KEY, adminid INT, bandate INT UNSIGNED, liftdate INT UNSIGNED, reason VARCHAR(250));
INSERT INTO vb_userban VALUES (3, 1, 1690000000, 4070908800, 'Rude &amp; loud');
CREATE TABLE vb_visitormessage (vmid INT PRIMARY KEY, userid INT, postuserid INT, dateline INT, pagetext MEDIUMTEXT, state VARCHAR(20));
INSERT INTO vb_visitormessage VALUES (1, 1, 2, 1700300000, 'Hi [B]alice[/B]', 'visible'), (2, 1, 0, 1700300100, 'guest', 'visible'), (3, 1, 3, 1700300200, 'hidden', 'moderation');

-- Avatars stored in the database: alice's is a 1x1 PNG in customavatar.filedata.
ALTER TABLE vb_user ADD COLUMN avatarrevision INT NOT NULL DEFAULT 0;
CREATE TABLE vb_customavatar (userid INT PRIMARY KEY, filedata MEDIUMBLOB, filename VARCHAR(100));
INSERT INTO vb_customavatar VALUES (1, FROM_BASE64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), 'a.png');

-- Infractions: carol has an active one, a reversed one (action 2) and an expired one.
CREATE TABLE vb_infraction (infractionid INT PRIMARY KEY, infractionlevelid INT, postid INT, userid INT, whoadded INT, points INT, dateline INT UNSIGNED, note VARCHAR(255), action SMALLINT, expires INT UNSIGNED, customreason VARCHAR(255));
INSERT INTO vb_infraction VALUES (1, 1, 100, 3, 1, 1, 1700000000, '', 0, 4070908800, 'Spam &amp; ads'), (2, 1, 100, 3, 1, 1, 1700000000, '', 2, 0, 'reversed'), (3, 1, 100, 3, 1, 1, 1600000000, '', 0, 1600100000, 'expired');

-- Member groups past the stock eight: "Donors" (9). Bob is in it as a member group.
CREATE TABLE vb_usergroup (usergroupid SMALLINT PRIMARY KEY, title CHAR(100) NOT NULL);
INSERT INTO vb_usergroup VALUES (2, 'Registered Users'), (6, 'Administrators'), (9, 'Donors &amp; Patrons');
UPDATE vb_user SET membergroupids = '7,9' WHERE userid = 2;

-- Thread prefixes: set "help" offered in forum 2 holds "solved" (rich title in green)
-- and "question"; thread 10 is solved.
CREATE TABLE vb_prefixset (prefixsetid VARCHAR(25) PRIMARY KEY, displayorder INT NOT NULL DEFAULT 0);
INSERT INTO vb_prefixset VALUES ('help', 1);
CREATE TABLE vb_prefix (prefixid VARCHAR(25) PRIMARY KEY, prefixsetid VARCHAR(25), displayorder INT NOT NULL DEFAULT 0, options INT NOT NULL DEFAULT 0);
INSERT INTO vb_prefix VALUES ('solved', 'help', 2, 0), ('question', 'help', 1, 0);
CREATE TABLE vb_phrase (phraseid INT PRIMARY KEY, languageid INT, varname VARCHAR(250), fieldname VARCHAR(20), text MEDIUMTEXT);
INSERT INTO vb_phrase VALUES (1, -1, 'prefix_solved_title_plain', 'global', 'Solved'), (2, -1, 'prefix_solved_title_rich', 'global', '<span style="color:green">Solved</span>'),
  (3, -1, 'prefix_question_title_plain', 'global', 'Question'), (4, 0, 'prefix_question_title_plain', 'global', 'Question &amp; Help');
CREATE TABLE vb_forumprefixset (forumid INT, prefixsetid VARCHAR(25));
INSERT INTO vb_forumprefixset VALUES (2, 'help');
ALTER TABLE vb_thread ADD COLUMN prefixid VARCHAR(25) NOT NULL DEFAULT '';
UPDATE vb_thread SET prefixid = 'solved' WHERE threadid = 10;

-- Last visit: alice's lastactivity (2021) is later than her lastvisit; carol never.
ALTER TABLE vb_user ADD COLUMN lastvisit INT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN lastactivity INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE vb_user SET lastvisit = 1600000000, lastactivity = 1610000000 WHERE userid = 1;
