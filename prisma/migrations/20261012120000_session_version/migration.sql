-- Per-user session version: bumping it invalidates every sign-in token issued before (sign out everywhere, password change).
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
