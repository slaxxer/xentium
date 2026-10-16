-- Minimal WoltLab Suite + Burning Board-shaped fixture (instance 1: wcf1_ / wbb1_).
-- The wcf1_ tables follow WoltLab's published install SQL (WCF is open source); the
-- wbb1_ tables carry the columns the extractor reads. Deliberately ugly seed data.
-- Passwords: gina = "secret7" (Bcrypt), hans = "secret8" (DoubleBcrypt),
-- ida = "secret9" (wcf1), jo has a phpBB hash WoltLab kept (resets once).

CREATE TABLE wcf1_package (packageID INT PRIMARY KEY, package VARCHAR(191), packageVersion VARCHAR(255));
INSERT INTO wcf1_package VALUES (1, 'com.woltlab.wcf', '6.1.3'), (2, 'com.woltlab.wbb', '6.1.1');

CREATE TABLE wcf1_user (
  userID INT PRIMARY KEY, username VARCHAR(100) NOT NULL DEFAULT '', email VARCHAR(191) NOT NULL DEFAULT '',
  password VARCHAR(255) NOT NULL DEFAULT 'invalid:', registrationDate INT NOT NULL DEFAULT 0
);
INSERT INTO wcf1_user VALUES
  (1, 'gina',  'gina@wl.test', 'Bcrypt:$2y$10$sqx8QvuJCj6m917cmpmrReWVVs07l0gj5XlYJtgPN2xp3.7ebibq.', 1600000000),
  (2, 'hans',  'hans@wl.test', '$2a$08$Xyz0123456789abcdefghe46o5TUHf9rdDs5OANyEwLtv5aqxgNOe', 1600000100),
  (3, 'ida',   'ida@wl.test',  CONCAT('wcf1:', SHA1(CONCAT('0123456789abcdef0123456789abcdef01234567', SHA1(CONCAT('0123456789abcdef0123456789abcdef01234567', SHA1('secret9'))))), ':0123456789abcdef0123456789abcdef01234567'), 1600000200),
  (4, 'jo',    'jo@wl.test',   'phpbb3:$H$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0', 1600000300),
  (5, 'nomail','',             'invalid:', 1600000400);

CREATE TABLE wcf1_user_group (groupID INT PRIMARY KEY, groupName VARCHAR(255), groupType TINYINT);
INSERT INTO wcf1_user_group VALUES (1,'wcf.acp.group.group1',1),(2,'wcf.acp.group.group2',2),(3,'wcf.acp.group.group3',3),(4,'wcf.acp.group.group4',9),(5,'wcf.acp.group.group5',4),(7,'Team',4);
CREATE TABLE wcf1_user_to_group (userID INT, groupID INT);
INSERT INTO wcf1_user_to_group VALUES (1,1),(1,3),(1,4),(2,1),(2,3),(2,7),(3,1),(3,3),(4,1),(4,3);
CREATE TABLE wcf1_user_group_option (optionID INT PRIMARY KEY, optionName VARCHAR(191));
INSERT INTO wcf1_user_group_option VALUES (10, 'admin.general.canUseAcp'), (11, 'mod.general.canUseModeration');
CREATE TABLE wcf1_user_group_option_value (groupID INT, optionID INT, optionValue MEDIUMTEXT);
-- The custom "Team" group (7) can moderate; stock group 5 has nobody in it here.
INSERT INTO wcf1_user_group_option_value VALUES (4, 10, '1'), (4, 11, '1'), (5, 11, '1'), (7, 11, '1'), (3, 10, '0');

CREATE TABLE wcf1_language (languageID INT PRIMARY KEY, languageCode VARCHAR(20), isDefault TINYINT);
INSERT INTO wcf1_language VALUES (1, 'de', 1), (2, 'en', 0);
CREATE TABLE wcf1_language_item (languageID INT, languageItem VARCHAR(191), languageItemValue MEDIUMTEXT);
INSERT INTO wcf1_language_item VALUES (1, 'wbb.board.board11.title', 'Allgemeines'), (2, 'wbb.board.board11.title', 'General');

CREATE TABLE wcf1_object_type (objectTypeID INT PRIMARY KEY, objectType VARCHAR(191), definitionID INT);
INSERT INTO wcf1_object_type VALUES (50, 'com.woltlab.wcf.article.category', 1), (51, 'com.woltlab.wbb.likeablePost', 2), (52, 'com.woltlab.wcf.likeableArticle', 2);

CREATE TABLE wcf1_category (categoryID INT PRIMARY KEY, objectTypeID INT, parentCategoryID INT DEFAULT 0, title VARCHAR(255), description TEXT, showOrder INT DEFAULT 0);
INSERT INTO wcf1_category VALUES (60, 50, 0, 'News', 'Site news', 1), (61, 99, 0, 'A gallery category', '', 1);

CREATE TABLE wcf1_article (articleID INT PRIMARY KEY, userID INT, time INT, categoryID INT, publicationStatus TINYINT, publicationDate INT DEFAULT 0, isDeleted TINYINT DEFAULT 0);
INSERT INTO wcf1_article VALUES (70, 1, 1610000000, 60, 1, 1610000000, 0), (71, 1, 1610000100, 60, 0, 0, 0), (72, NULL, 1610000200, 60, 1, 0, 0), (73, 1, 1610000300, 60, 1, 0, 1);
CREATE TABLE wcf1_article_content (articleContentID INT PRIMARY KEY, articleID INT, languageID INT, title VARCHAR(255), teaser TEXT, content MEDIUMTEXT);
INSERT INTO wcf1_article_content VALUES
  (80, 70, 2, 'Launch (EN)', 'Teaser', '<p>English body</p>'),
  (81, 70, 1, 'Start (DE)', 'Anriss', '<p>Deutscher Text <strong>fett</strong></p><woltlab-quote data-author="gina"><p>q</p></woltlab-quote>'),
  (82, 71, NULL, 'Draft one', NULL, '<p>draft</p>'),
  (83, 72, NULL, 'Orphan', NULL, '<p>no author</p>'),
  (84, 73, NULL, 'Gone', NULL, '<p>deleted</p>');

CREATE TABLE wcf1_like (likeID INT PRIMARY KEY AUTO_INCREMENT, objectID INT, objectTypeID INT, userID INT, time INT, likeValue TINYINT DEFAULT 1, reactionTypeID INT DEFAULT 1);
INSERT INTO wcf1_like (objectID, objectTypeID, userID, time) VALUES (200, 51, 2, 1620000900), (201, 51, 1, 1620000950), (70, 52, 2, 1620000960);
CREATE TABLE wcf1_user_follow (followID INT PRIMARY KEY AUTO_INCREMENT, userID INT, followUserID INT, time INT);
INSERT INTO wcf1_user_follow (userID, followUserID, time) VALUES (2, 1, 1620001000);
CREATE TABLE wcf1_user_ignore (ignoreID INT PRIMARY KEY AUTO_INCREMENT, userID INT, ignoreUserID INT, time INT, type TINYINT DEFAULT 1);
INSERT INTO wcf1_user_ignore (userID, ignoreUserID, time) VALUES (3, 2, 1620001100);

CREATE TABLE wbb1_board (boardID INT PRIMARY KEY, parentID INT, boardType TINYINT, title VARCHAR(255), description TEXT, position INT);
INSERT INTO wbb1_board VALUES (10, NULL, 1, 'Community', 'Top', 1), (11, 10, 0, 'wbb.board.board11.title', '', 1), (12, 10, 2, 'Homepage', '', 2);

-- No `views` column on purpose: the extractor must cope with a column a version lacks.
CREATE TABLE wbb1_thread (threadID INT PRIMARY KEY, boardID INT, topic VARCHAR(255), userID INT, time INT, isClosed TINYINT DEFAULT 0, isSticky TINYINT DEFAULT 0, isAnnouncement TINYINT DEFAULT 0, isDisabled TINYINT DEFAULT 0, isDeleted TINYINT DEFAULT 0, movedThreadID INT);
INSERT INTO wbb1_thread VALUES
  (100, 11, 'Welcome <all>', 1, 1620000000, 0, 1, 0, 0, 0, NULL),
  (101, 11, 'Old BBCode thread', 2, 1620000100, 1, 0, 0, 0, 0, NULL),
  (102, 11, 'Moved', 2, 1620000200, 0, 0, 0, 0, 0, 100),
  (103, 11, 'Pending', 2, 1620000300, 0, 0, 0, 1, 0, NULL),
  (104, 11, 'By a guest', NULL, 1620000400, 0, 0, 0, 0, 0, NULL);

CREATE TABLE wbb1_post (postID INT PRIMARY KEY, threadID INT, userID INT, message MEDIUMTEXT, time INT, lastEditTime INT DEFAULT 0, isDisabled TINYINT DEFAULT 0, isDeleted TINYINT DEFAULT 0);
INSERT INTO wbb1_post VALUES
  (200, 100, 1, '<p>Hello <strong>all</strong> <a href="javascript:alert(1)">bad</a> <a href="https://ok.test">good</a></p><p><img src="https://x.test/s.png" alt=";)" class="smiley"></p>', 1620000000, 0, 0, 0),
  (201, 100, 2, '<woltlab-quote data-author="gina" data-link="https://x.test"><p>Hello</p></woltlab-quote><p>Hi! <woltlab-metacode data-name="attach" data-attributes="WzEyXQ=="></woltlab-metacode></p>', 1620000050, 1620000999, 0, 0),
  (202, 100, NULL, '<p>guest</p>', 1620000060, 0, 0, 0),
  (203, 100, 3, '<p>deleted</p>', 1620000070, 0, 0, 1),
  (204, 101, 2, '[quote=''gina'',''https://x.test'']old[/quote] [b]bold[/b] & <script>', 1620000100, 0, 0, 0),
  (205, 102, 2, 'moved', 1620000200, 0, 0, 0);

-- Conversations: gina ↔ hans (hans hid it), a group one where ida left, and a draft.
CREATE TABLE wcf1_conversation (conversationID INT PRIMARY KEY, subject VARCHAR(255), time INT, userID INT, isDraft TINYINT DEFAULT 0);
INSERT INTO wcf1_conversation VALUES (1, 'Moderation', 1630000000, 1, 0), (2, 'Group chat', 1630000100, 2, 0), (3, 'Unsent', 1630000200, 1, 1);
CREATE TABLE wcf1_conversation_to_user (conversationID INT, participantID INT, hideConversation TINYINT DEFAULT 0, leftAt INT DEFAULT 0);
INSERT INTO wcf1_conversation_to_user VALUES (1, 1, 0, 0), (1, 2, 1, 0), (2, 2, 0, 0), (2, 1, 0, 0), (2, 3, 0, 1630000500), (3, 2, 0, 0);
CREATE TABLE wcf1_conversation_message (messageID INT PRIMARY KEY, conversationID INT, userID INT, message MEDIUMTEXT, time INT);
INSERT INTO wcf1_conversation_message VALUES
  (1, 1, 1, '<p>Please check <strong>this</strong></p>', 1630000000),
  (2, 1, 2, '<woltlab-quote data-author="gina"><p>Please check</p></woltlab-quote><p>Done</p>', 1630000050),
  (3, 2, 2, '<p>Hi all</p>', 1630000100),
  (4, 3, 1, '<p>draft text</p>', 1630000200);

-- Personal info, bans, tags, watches, profile and article comments. Expect: gina born
-- 1988-02-29 with a homepage, hans's hidden-year birthday ignored; jo banned until 2099;
-- thread 100 tagged; hans watches 100 (kept) and 103 (skipped, no subscription); a wall
-- post on gina's profile by hans with gina's reply; a comment on article 70 (imported)
-- with a reply, and one on article 73 (deleted, not imported) that must stay out.
CREATE TABLE wcf1_object_type_definition (definitionID INT PRIMARY KEY, definitionName VARCHAR(191));
INSERT INTO wcf1_object_type_definition VALUES (1, 'com.woltlab.wcf.category'), (2, 'com.woltlab.wcf.like.likeableObject'),
  (3, 'com.woltlab.wcf.comment.commentableContent'), (4, 'com.woltlab.wcf.tagging.taggableObject'), (5, 'com.woltlab.wcf.user.objectWatch');
INSERT INTO wcf1_object_type VALUES (53, 'com.woltlab.wcf.articleComment', 3), (54, 'com.woltlab.wcf.user.profileComment', 3),
  (55, 'com.woltlab.wbb.thread', 4), (56, 'com.woltlab.wbb.thread', 5);
CREATE TABLE wcf1_user_option (optionID INT PRIMARY KEY, optionName VARCHAR(191));
INSERT INTO wcf1_user_option VALUES (2, 'birthday'), (7, 'homepage'), (9, 'aboutMe');
CREATE TABLE wcf1_user_option_value (userID INT PRIMARY KEY, userOption2 TEXT, userOption7 TEXT, userOption9 TEXT);
INSERT INTO wcf1_user_option_value VALUES (1, '1988-02-29', 'https://gina.example', 'about gina'), (2, '0000-05-01', '', '');
ALTER TABLE wcf1_user ADD COLUMN banned TINYINT NOT NULL DEFAULT 0, ADD COLUMN banReason MEDIUMTEXT, ADD COLUMN banExpires INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE wcf1_user SET banned = 1, banReason = 'Ban evasion', banExpires = 4070908800 WHERE userID = 4;
CREATE TABLE wcf1_tag (tagID INT PRIMARY KEY, name VARCHAR(255));
INSERT INTO wcf1_tag VALUES (1, 'Willkommen'), (2, 'news');
CREATE TABLE wcf1_tag_to_object (objectID INT, tagID INT, objectTypeID INT, languageID INT);
INSERT INTO wcf1_tag_to_object VALUES (100, 1, 55, 1), (100, 2, 55, 1), (100, 2, 56, 1);
CREATE TABLE wcf1_user_object_watch (watchID INT PRIMARY KEY AUTO_INCREMENT, objectTypeID INT, objectID INT, userID INT, notification TINYINT DEFAULT 0);
INSERT INTO wcf1_user_object_watch (objectTypeID, objectID, userID) VALUES (56, 100, 2), (56, 103, 2), (55, 100, 3);
CREATE TABLE wcf1_comment (commentID INT PRIMARY KEY, objectTypeID INT, objectID INT, userID INT, time INT, message MEDIUMTEXT, isDisabled TINYINT DEFAULT 0);
INSERT INTO wcf1_comment VALUES
  (1, 54, 1, 2, 1640000000, '<p>Great <strong>profile</strong></p>', 0),
  (2, 53, 70, 3, 1640000100, '<p>Nice article!</p>', 0),
  (3, 53, 73, 3, 1640000200, '<p>on a deleted article</p>', 0),
  (4, 54, 1, 3, 1640000300, '<p>hidden</p>', 1);
CREATE TABLE wcf1_comment_response (responseID INT PRIMARY KEY, commentID INT, userID INT, time INT, message MEDIUMTEXT, isDisabled TINYINT DEFAULT 0);
INSERT INTO wcf1_comment_response VALUES (1, 1, 1, 1640000400, '<p>Thanks!</p>', 0), (2, 2, 1, 1640000500, '<p>Glad you liked it</p>', 0);

-- Avatars (files under --files): gina in the 6.0 layout, hans in the 6.1 file system.
CREATE TABLE wcf1_user_avatar (avatarID INT PRIMARY KEY, userID INT, fileHash VARCHAR(40), avatarExtension VARCHAR(7));
INSERT INTO wcf1_user_avatar VALUES (5, 1, 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12', 'png');
ALTER TABLE wcf1_user ADD COLUMN avatarFileID INT;
CREATE TABLE wcf1_file (fileID INT PRIMARY KEY, filename VARCHAR(255), fileHash CHAR(64), fileExtension VARCHAR(10));
INSERT INTO wcf1_file VALUES (9, 'me.png', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'png');
UPDATE wcf1_user SET avatarFileID = 9 WHERE userID = 2;

-- Member groups: custom ones are groupType 4. "Team" (7) moderates, so it's a role; "VIP"
-- (8) and a translated group (9, "Spender" in the default language) come over. Users 3 and 4 are in them.
INSERT INTO wcf1_user_group VALUES (8, 'VIP', 4), (9, 'wcf.acp.group.group9', 4);
INSERT INTO wcf1_user_to_group VALUES (3, 8), (4, 9), (4, 8);
INSERT INTO wcf1_language_item (languageID, languageItem, languageItemValue) SELECT languageID, 'wcf.acp.group.group9', 'Spender' FROM wcf1_language WHERE isDefault = 1;

-- Labels: group "Status" (first) offered in board 11 holds "Erledigt" (green); group
-- "Type" holds a translated label ("Frage", blue) offered everywhere. Thread 100 carries
-- both (the first group's wins: Erledigt), thread 101 carries "Frage".
INSERT INTO wcf1_object_type_definition VALUES (6, 'com.woltlab.wcf.label.object'), (7, 'com.woltlab.wcf.label.objectType');
INSERT INTO wcf1_object_type VALUES (57, 'com.woltlab.wbb.thread', 6), (58, 'com.woltlab.wbb.board', 7);
CREATE TABLE wcf1_label_group (groupID INT PRIMARY KEY, groupName VARCHAR(80), showOrder INT NOT NULL DEFAULT 0);
INSERT INTO wcf1_label_group VALUES (1, 'Status', 1), (2, 'Type', 2);
CREATE TABLE wcf1_label (labelID INT PRIMARY KEY, groupID INT, label VARCHAR(80), cssClassName VARCHAR(255), showOrder INT NOT NULL DEFAULT 0);
INSERT INTO wcf1_label VALUES (1, 1, 'Erledigt', 'green', 0), (2, 2, 'wcf.acp.label.label2', 'badge blue', 0);
INSERT INTO wcf1_language_item (languageID, languageItem, languageItemValue) SELECT languageID, 'wcf.acp.label.label2', 'Frage' FROM wcf1_language WHERE isDefault = 1;
CREATE TABLE wcf1_label_group_to_object (groupID INT, objectTypeID INT, objectID INT);
INSERT INTO wcf1_label_group_to_object VALUES (1, 58, 11);
CREATE TABLE wcf1_label_object (labelID INT, objectTypeID INT, objectID INT);
INSERT INTO wcf1_label_object VALUES (2, 57, 100), (1, 57, 100), (2, 57, 101);

ALTER TABLE wcf1_user ADD COLUMN lastActivityTime INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE wcf1_user SET lastActivityTime = 1700000000 WHERE userID = 2;
