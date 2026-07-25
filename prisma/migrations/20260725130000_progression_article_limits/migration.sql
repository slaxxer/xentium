-- Core keeps its own article limits after the §38 core/plugin split: the old
-- max_post_length / max_daily_posts were enforced on ARTICLES in core (the forum
-- plugin merely reused the same middleware). Comment limits alone would have
-- silently dropped that enforcement.
ALTER TABLE "ncf_group_progression" ADD COLUMN "max_article_length" INTEGER;
ALTER TABLE "ncf_group_progression" ADD COLUMN "max_daily_articles" INTEGER;
