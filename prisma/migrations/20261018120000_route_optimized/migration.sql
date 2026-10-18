-- Optimized-route marker: the signature of the stops Optimize route last ran on; NULL = never optimized.
ALTER TABLE "Trip" ADD COLUMN "routeOptimizedFor" TEXT;
