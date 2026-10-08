-- Read-only share link: nullable unique token per trip (null = not shared).
ALTER TABLE "Trip" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Trip_shareToken_key" ON "Trip"("shareToken");
