-- Local copy of OpenStreetMap photo-spot candidates; filled by scripts/import-places.mjs.
CREATE TABLE "Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "cell" INTEGER NOT NULL
);
CREATE INDEX "Place_cell_idx" ON "Place"("cell");
