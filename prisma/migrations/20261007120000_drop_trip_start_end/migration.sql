-- Trips are now just ordered stops; the start/end columns are no longer used.
ALTER TABLE "Trip" DROP COLUMN "startName";
ALTER TABLE "Trip" DROP COLUMN "startLat";
ALTER TABLE "Trip" DROP COLUMN "startLng";
ALTER TABLE "Trip" DROP COLUMN "endName";
ALTER TABLE "Trip" DROP COLUMN "endLat";
ALTER TABLE "Trip" DROP COLUMN "endLng";
