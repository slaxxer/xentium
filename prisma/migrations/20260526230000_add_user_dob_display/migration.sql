-- Per-user preference for how their date_of_birth profile field is shown on
-- their public profile. 'age' (default) | 'date' | 'hidden'.
ALTER TABLE "User" ADD COLUMN "dob_display" TEXT NOT NULL DEFAULT 'age';
