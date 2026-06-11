ALTER TABLE "User" ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS "User_search_idx" ON "User" USING GIN(search_vector);

CREATE OR REPLACE FUNCTION user_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('pg_catalog.english', COALESCE(NEW.username,     '')), 'A')
   || setweight(to_tsvector('pg_catalog.english', COALESCE(NEW.display_name, '')), 'B')
   || setweight(to_tsvector('pg_catalog.english', COALESCE(NEW.bio,          '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_search_vector_trigger ON "User";

CREATE TRIGGER user_search_vector_trigger
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION user_search_vector_update();

UPDATE "User" SET search_vector =
    setweight(to_tsvector('pg_catalog.english', COALESCE(username,     '')), 'A')
 || setweight(to_tsvector('pg_catalog.english', COALESCE(display_name, '')), 'B')
 || setweight(to_tsvector('pg_catalog.english', COALESCE(bio,          '')), 'C');

UPDATE articles SET search_vector =
    setweight(to_tsvector('pg_catalog.english', COALESCE(title,      '')), 'A')
 || setweight(to_tsvector('pg_catalog.english', COALESCE(excerpt,    '')), 'B')
 || setweight(to_tsvector('pg_catalog.english', COALESCE(body_plain, '')), 'C')
WHERE search_vector IS NULL;
