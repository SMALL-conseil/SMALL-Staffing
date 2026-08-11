-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "boondState" TEXT,
ADD COLUMN     "boondSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BOOND',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL,
    "report" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_kind_startedAt_idx" ON "SyncRun"("kind", "startedAt");
