-- CreateTable
CREATE TABLE "SuggestionCache" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,

    PRIMARY KEY ("key", "kind")
);

-- CreateIndex
CREATE INDEX "SuggestionCache_createdAt_idx" ON "SuggestionCache"("createdAt");
