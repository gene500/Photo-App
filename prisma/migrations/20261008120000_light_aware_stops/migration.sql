-- Light-aware routing: per-stop preferred light and time spent, optional trip departure.
ALTER TABLE "Stop" ADD COLUMN "lightPref" TEXT NOT NULL DEFAULT 'any';
ALTER TABLE "Stop" ADD COLUMN "dwellMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Trip" ADD COLUMN "departAt" DATETIME;
