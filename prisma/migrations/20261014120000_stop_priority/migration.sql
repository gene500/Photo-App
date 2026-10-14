-- Stop priority: how strongly Optimize route protects a stop's preferred light.
ALTER TABLE "Stop" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
