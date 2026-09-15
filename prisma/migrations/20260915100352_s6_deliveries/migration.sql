-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "deliveryBoondId" TEXT;

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "boondId" TEXT NOT NULL,
    "title" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "dailyRate" DOUBLE PRECISION,
    "daysSold" DOUBLE PRECISION,
    "state" TEXT,
    "typeOf" TEXT,
    "projectBoondId" TEXT,
    "projectName" TEXT,
    "clientName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_boondId_key" ON "Delivery"("boondId");

-- CreateIndex
CREATE INDEX "Delivery_projectBoondId_idx" ON "Delivery"("projectBoondId");

-- CreateIndex
CREATE INDEX "TimeEntry_deliveryBoondId_idx" ON "TimeEntry"("deliveryBoondId");
