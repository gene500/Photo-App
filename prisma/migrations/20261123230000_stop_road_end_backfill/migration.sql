-- Stops whose parking-lot lookup finished before road ends existed (no lot found) were never looked at again.
-- Clear their "finished" mark so the app looks them up once more on the next open and can give them a road end and trail.
-- Stops that have a lot, and stops never resolved, are untouched.
UPDATE "Stop" SET "accessResolvedAt" = NULL WHERE "accessLat" IS NULL AND "accessResolvedAt" IS NOT NULL;
