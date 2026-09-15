-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "agency" TEXT;

-- CreateIndex
CREATE INDEX "Person_agency_idx" ON "Person"("agency");
