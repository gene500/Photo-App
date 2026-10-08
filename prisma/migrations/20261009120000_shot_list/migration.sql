-- Shot list per stop: free-text notes and a JSON checklist ([{ text, done }]).
ALTER TABLE "Stop" ADD COLUMN "shotNotes" TEXT;
ALTER TABLE "Stop" ADD COLUMN "shotChecklist" TEXT NOT NULL DEFAULT '[]';
